import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeCustomer, makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
async function stocked(price = 100_000, cost = 40_000) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 20, unitCost: cost, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
const sell = (body: object) => req('POST', '/api/invoices', body).then(r => r.json());

test('refund uses the invoice net price even after the base price changed', async () => {
  const p = await stocked(100_000);
  const inv = await sell({ lines: [{ productId: p.id, qty: 2, price: 100_000 }], invoiceDiscount: 20_000, payments: [{ method: 'cash', amount: 180_000 }] });
  await t.prisma.product.update({ where: { id: p.id }, data: { price: 150_000 } });
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  expect(draft.lines[0]).toMatchObject({ qty: 2, price: 90_000 });
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' })).json();
  expect(ret.code).toMatch(/^TH\d{6}$/);
  expect(ret).toMatchObject({ total: 90_000, refunded: 90_000 });
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(19);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'return', sourceId: ret.id } });
  expect(v).toMatchObject({ kind: 'out', amount: 90_000 });
  expect(v.code).toMatch(/^TTTH/);
});

test('partial returns are capped across returns', async () => {
  const p = await stocked();
  const inv = await sell({ lines: [{ productId: p.id, qty: 2, price: 100_000 }], payments: [{ method: 'cash', amount: 200_000 }] });
  const lineId = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json().lines[0].invoiceLineId;
  await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: lineId, qty: 2 }], refundMethod: 'cash' });
  const again = await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: 'cash' });
  expect(again.json().error.code).toBe('RETURN_EXCEEDS_SALE');
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).json().error.code).toBe('HAS_RETURNS');
});

test('refund to debt and proportional points reversal', async () => {
  const p = await stocked(1_000_000);
  const c = await makeCustomer(t.prisma);
  const inv = await sell({ customerId: c.id, lines: [{ productId: p.id, qty: 2, price: 1_000_000 }] });
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(2_000_000);
  const lineId = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json().lines[0].invoiceLineId;
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: 'debt' })).json();
  const cust = await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(cust.debt).toBe(1_000_000);
  expect(ret.pointsReversed).toBe(Math.floor(inv.pointsEarned / 2));
  expect(cust.points).toBe(inv.pointsEarned - ret.pointsReversed);
  expect(cust.totalSpent).toBe(1_000_000);
});

test('an exchange nets the difference: credit pays the new invoice, the rest is change', async () => {
  const a = await stocked(300_000);
  const b = await stocked(100_000);
  const inv = await sell({ lines: [{ productId: a.id, qty: 1, price: 300_000 }], payments: [{ method: 'cash', amount: 300_000 }] });
  const lineId = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json().lines[0].invoiceLineId;
  const res = await req('POST', '/api/returns', {
    invoiceId: inv.id, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: 'exchange',
    exchange: { lines: [{ productId: b.id, qty: 1, price: 100_000 }], payments: [] },
  });
  expect(res.statusCode).toBe(200);
  const ret = res.json();
  expect(ret.exchangeInvoice).toMatchObject({ total: 100_000, change: 200_000 });
  expect((await getBranchStock(t.prisma, a.id, branchId)).onHand).toBe(20);
  expect((await getBranchStock(t.prisma, b.id, branchId)).onHand).toBe(19);
  const out = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'invoice', sourceId: ret.exchangeInvoice.id, kind: 'out' } });
  expect(out.amount).toBe(200_000);
});

test('a quick return without an invoice puts stock back at current cost', async () => {
  const p = await stocked(100_000, 40_000);
  const ret = (await req('POST', '/api/returns', { lines: [{ productId: p.id, qty: 1, price: 80_000 }], refundMethod: 'cash' })).json();
  expect(ret.total).toBe(80_000);
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 21, cost: 40_000 });
});

test('cancelling a return restores stock, cash and the returnable quantity', async () => {
  const p = await stocked();
  const inv = await sell({ lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  const lineId = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json().lines[0].invoiceLineId;
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: lineId, qty: 1 }], refundMethod: 'cash' })).json();
  await req('POST', `/api/returns/${ret.id}/cancel`, {});
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(19);
  expect((await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'return', sourceId: ret.id } })).status).toBe('cancelled');
  expect((await req('GET', `/api/invoices/${inv.id}/return-draft`)).json().lines[0].qty).toBe(1);
});
