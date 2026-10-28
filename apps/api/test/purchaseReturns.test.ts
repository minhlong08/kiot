import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct, makeSupplier } from './factories';
import { getBranchStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const debt = async (id: number) => (await t.prisma.supplier.findUniqueOrThrow({ where: { id } })).debt;

async function received(qty = 10, unitCost = 100_000) {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty, unitCost }], complete: true })).json();
  return { s, p, r };
}

test('return-draft offers the returnable quantity at the receipt price', async () => {
  const { p, r } = await received(10, 100_000);
  const d = (await req('GET', `/api/purchase-receipts/${r.id}/return-draft`)).json();
  expect(d.lines[0]).toMatchObject({ productId: p.id, qty: 10, price: 100_000 });
});

test('a return reduces stock and debt; cost stays', async () => {
  const { s, p, r } = await received(10, 100_000);
  const ret = (await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 4, price: 100_000 }], complete: true })).json();
  expect(ret.code).toMatch(/^THN\d{6}$/);
  expect(ret).toMatchObject({ status: 'completed', total: 400_000 });
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 6, cost: 100_000 });
  expect(await debt(s.id)).toBe(600_000);
});

test('a refund from the supplier writes a cash-in voucher and adjusts debt', async () => {
  const { s, p, r } = await received(5, 100_000);
  const ret = (await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 2, price: 100_000 }], refund: 200_000, complete: true })).json();
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'purchaseReturn', sourceId: ret.id } });
  expect(v).toMatchObject({ kind: 'in', amount: 200_000 });
  expect(v.code).toMatch(/^TTTHN\d{6}$/);
  expect(await debt(s.id)).toBe(500_000);
});

test('returning beyond what remains on the receipt is refused across returns', async () => {
  const { s, p, r } = await received(5);
  await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 3, price: 100_000 }], complete: true });
  const res = await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 3, price: 100_000 }], complete: true });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('RETURN_EXCEEDS_RECEIPT');
});

test('a receipt with returns cannot be cancelled', async () => {
  const { s, p, r } = await received(5);
  await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 1, price: 100_000 }], complete: true });
  expect((await req('POST', `/api/purchase-receipts/${r.id}/cancel`, {})).json().error.code).toBe('HAS_RETURNS');
});

test('cancelling a return restores stock, debt, the voucher and the returnable quantity', async () => {
  const { s, p, r } = await received(5, 100_000);
  const ret = (await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 5, price: 100_000 }], refund: 100_000, complete: true })).json();
  await req('POST', `/api/purchase-returns/${ret.id}/cancel`, {});
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(5);
  expect(await debt(s.id)).toBe(500_000);
  expect((await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'purchaseReturn', sourceId: ret.id } })).status).toBe('cancelled');
  expect((await req('GET', `/api/purchase-receipts/${r.id}/return-draft`)).json().lines[0].qty).toBe(5);
});

test('a standalone return (no receipt) works', async () => {
  const { s, p } = await received(3);
  const ret = (await req('POST', '/api/purchase-returns', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, price: 90_000 }], complete: true })).json();
  expect(ret.total).toBe(90_000);
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(2);
});
