import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { fakeUser, makeCustomer, makeProduct } from './factories';
import { seedBase } from '../src/seed/base';
import { ensureCashDefaults } from '../src/services/cash';
import { getBranchStock, moveStock } from '../src/services/stock';
import { postLoyalty } from '../src/services/loyalty';
import { cancelInvoice, createInvoice } from '../src/services/sales';
import type { z } from 'zod';
import { invoiceInputSchema } from '@pd/shared';

const db = createTestDb();
const prisma = db.prisma;
let branchId: number;
const ctx = () => ({ userId: 1, branchId, ip: '' });
const admin = () => fakeUser({ isAdmin: true, maxDiscountPercent: 100, branchId });
const cashier = () => fakeUser({ branchId });
const input = (o: z.input<typeof invoiceInputSchema>) => invoiceInputSchema.parse(o);
const sell = (o: Parameters<typeof input>[0], u = admin()) => prisma.$transaction(tx => createInvoice(tx, ctx(), input(o), u));

async function stocked(qty = 10, price = 100_000, cost = 60_000, o: Parameters<typeof makeProduct>[1] = {}) {
  const p = await makeProduct(prisma, { price, cost: 0, ...o });
  await moveStock(prisma, { productId: p.id, branchId, qty, unitCost: cost, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
beforeAll(async () => { await seedBase(prisma); await ensureCashDefaults(prisma); branchId = (await prisma.branch.findFirstOrThrow()).id; });
afterAll(() => db.close());

test('a sale stores server totals, COGS, stock, a cash voucher, customer debt and points', async () => {
  const p = await stocked(10, 1_000_000, 600_000);
  const c = await makeCustomer(prisma);
  await postLoyalty(prisma, { customerId: c.id, points: 100, docType: 'seed', docId: 0, docCode: 'X' });
  const inv = await sell({ customerId: c.id, lines: [{ productId: p.id, qty: 2, price: 1_000_000 }], invoiceDiscount: 100_000, pointsUsed: 100, payments: [{ method: 'cash', amount: 1_500_000 }] });
  expect(inv.code).toMatch(/^HD\d{6}$/);
  expect(inv).toMatchObject({ status: 'completed', subtotal: 2_000_000, total: 1_900_000, pointsValue: 100_000, paid: 1_500_000, debt: 300_000, costTotal: 1_200_000 });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(8);
  const line = await prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: inv.id } });
  expect(line.cost).toBe(600_000);
  const v = await prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'invoice', sourceId: inv.id } });
  expect(v).toMatchObject({ kind: 'in', amount: 1_500_000 });
  expect(v.code).toMatch(/^TTHD\d{6}$/);
  const cust = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(cust.debt).toBe(300_000);
  expect(cust.points).toBe(0 + inv.pointsEarned);
  expect(cust.totalSpent).toBe(1_900_000);
});

test('the client cannot change a price without pos.editPrice', async () => {
  const p = await stocked();
  await expect(sell({ lines: [{ productId: p.id, qty: 1, price: 50_000 }], payments: [{ method: 'cash', amount: 50_000 }] }, cashier())).rejects.toMatchObject({ code: 'PRICE_NOT_ALLOWED' });
});

test('manual discount above the role limit is refused', async () => {
  const p = await stocked();
  await expect(sell({ lines: [{ productId: p.id, qty: 1, price: 100_000, discount: 20_000 }], payments: [{ method: 'cash', amount: 80_000 }] }, cashier())).rejects.toMatchObject({ code: 'DISCOUNT_LIMIT' });
});

test('a walk-in sale must be paid in full', async () => {
  const p = await stocked();
  await expect(sell({ lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 50_000 }] })).rejects.toMatchObject({ code: 'MUST_PAY_IN_FULL' });
});

test('debt limit', async () => {
  const p = await stocked();
  const c = await makeCustomer(prisma);
  await prisma.setting.upsert({ where: { key: 'customers' }, create: { key: 'customers', value: JSON.stringify({ loyaltyEnabled: true, vndPerPoint: 10000, pointValueVnd: 1000, debtLimit: 50_000 }) }, update: { value: JSON.stringify({ loyaltyEnabled: true, vndPerPoint: 10000, pointValueVnd: 1000, debtLimit: 50_000 }) } });
  await expect(sell({ customerId: c.id, lines: [{ productId: p.id, qty: 1, price: 100_000 }] })).rejects.toMatchObject({ code: 'DEBT_LIMIT' });
  await prisma.setting.delete({ where: { key: 'customers' } });
});

test('a combo sale deducts components and stores the component cost', async () => {
  const a = await stocked(5, 100_000, 30_000);
  const b = await stocked(5, 100_000, 50_000);
  const combo = await makeProduct(prisma, { type: 'combo', price: 150_000 });
  await prisma.comboItem.createMany({ data: [{ comboId: combo.id, itemId: a.id, qty: 1 }, { comboId: combo.id, itemId: b.id, qty: 1 }] });
  const inv = await sell({ lines: [{ productId: combo.id, qty: 2, price: 150_000 }], payments: [{ method: 'cash', amount: 300_000 }] });
  expect(inv.costTotal).toBe(160_000);
  expect((await getBranchStock(prisma, a.id, branchId)).onHand).toBe(3);
});

test('a sale in boxes deducts base units', async () => {
  const p = await stocked(12, 20_000, 10_000);
  const unit = await prisma.productUnit.create({ data: { productId: p.id, name: 'hộp', conversion: 6, code: `${p.code}-H`, price: 110_000 } });
  await sell({ lines: [{ productId: p.id, unitId: unit.id, qty: 1, price: 110_000 }], payments: [{ method: 'cash', amount: 110_000 }] });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(6);
});

test('replaying the same clientUuid returns the same invoice', async () => {
  const p = await stocked();
  const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const a = await sell({ clientUuid: uuid, lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  const b = await sell({ clientUuid: uuid, lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  expect(b.id).toBe(a.id);
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(9);
});

test('cancelling reverses stock, cash, debt, points and spend', async () => {
  const p = await stocked();
  const c = await makeCustomer(prisma);
  const inv = await sell({ customerId: c.id, lines: [{ productId: p.id, qty: 3, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  await prisma.$transaction(tx => cancelInvoice(tx, ctx(), inv.id));
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(10);
  const cust = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(cust).toMatchObject({ debt: 0, points: 0, totalSpent: 0 });
  expect((await prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'invoice', sourceId: inv.id } })).status).toBe('cancelled');
  await expect(prisma.$transaction(tx => cancelInvoice(tx, ctx(), inv.id))).rejects.toMatchObject({ code: 'STATE_CHANGED' });
});

test('transfer payments go to the configured bank fund', async () => {
  const p = await stocked();
  const bank = await prisma.cashFund.create({ data: { type: 'bank', name: 'VCB' } });
  const inv = await sell({ lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'transfer', amount: 100_000, fundId: bank.id }] });
  expect((await prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'invoice', sourceId: inv.id } })).fundId).toBe(bank.id);
});

test('delivery sales stay processing and the unpaid part is COD, not customer debt', async () => {
  const p = await stocked();
  const c = await makeCustomer(prisma);
  const inv = await sell({ customerId: c.id, lines: [{ productId: p.id, qty: 1, price: 100_000 }], delivery: { receiverName: 'Lan', receiverPhone: '0901000111', address: '1 Lê Lợi', fee: 20_000, cod: 100_000 } });
  expect(inv.status).toBe('processing');
  expect((await prisma.invoiceDelivery.findUniqueOrThrow({ where: { invoiceId: inv.id } })).cod).toBe(100_000);
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(0);
});
