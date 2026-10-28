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
const incoming = async (pid: number) => (await getBranchStock(t.prisma, pid, branchId)).incoming;

async function po(qty: number) {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const o = (await req('POST', '/api/purchase-orders', { supplierId: s.id, lines: [{ productId: p.id, qty, unitCost: 1000 }], confirm: true })).json();
  const receive = (n: number, complete = true) => req('POST', '/api/purchase-receipts', { supplierId: s.id, purchaseOrderId: o.id, lines: [{ productId: p.id, qty: n, unitCost: 1000 }], complete }).then(r => r.json());
  return { s, p, o, receive };
}

test('C1: cancelling a receipt of an order completed by receiving restores incoming; later receipts never go negative', async () => {
  const { p, o, receive } = await po(10);
  const r1 = await receive(6);
  await receive(6);
  expect(await incoming(p.id)).toBe(0);
  await req('POST', `/api/purchase-receipts/${r1.id}/cancel`, {});
  expect((await req('GET', `/api/purchase-orders/${o.id}`)).json().status).toBe('partial');
  expect(await incoming(p.id)).toBe(4);
  await receive(4);
  expect(await incoming(p.id)).toBe(0);
});

test('C1: a draft receipt cannot be completed against a closed order, and a closed order stays closed', async () => {
  const { p, o, receive } = await po(10);
  const draft = await receive(3, false);
  await receive(2);
  await req('POST', `/api/purchase-orders/${o.id}/close`, {});
  const res = await req('POST', `/api/purchase-receipts/${draft.id}/complete`, {});
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('ORDER_NOT_OPEN');
  expect((await req('GET', `/api/purchase-orders/${o.id}`)).json().status).toBe('completed');
  expect(await incoming(p.id)).toBe(0);
});

test('I1: completing an old draft is dated now, not when the draft was saved', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const d = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 1000 }], paid: 1000 })).json();
  const yesterday = new Date(Date.now() - 86400_000);
  await t.prisma.purchaseReceipt.update({ where: { id: d.id }, data: { createdAt: yesterday } });
  await req('POST', `/api/purchase-receipts/${d.id}/complete`, {});
  const ledger = await t.prisma.stockLedger.findFirstOrThrow({ where: { docType: 'receipt', docId: d.id } });
  const voucher = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'receipt', sourceId: d.id } });
  expect(Date.now() - ledger.createdAt.getTime()).toBeLessThan(60_000);
  expect(Date.now() - voucher.createdAt.getTime()).toBeLessThan(60_000);
});

test('I2: payments refuse inactive funds and funds of another branch', async () => {
  const s = await makeSupplier(t.prisma);
  const other = await t.prisma.branch.create({ data: { code: 'CN08', name: 'CN8' } });
  const foreign = await t.prisma.cashFund.create({ data: { type: 'bank', name: 'Quỹ CN8', branchId: other.id } });
  const inactive = await t.prisma.cashFund.create({ data: { type: 'bank', name: 'Đã đóng', isActive: false } });
  expect((await req('POST', `/api/suppliers/${s.id}/payments`, { amount: 1000, fundId: foreign.id })).statusCode).toBe(404);
  expect((await req('POST', `/api/suppliers/${s.id}/payments`, { amount: 1000, fundId: inactive.id })).statusCode).toBe(404);
});

test('I3: a draft return cannot be completed after its receipt was cancelled', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 5, unitCost: 1000 }], complete: true })).json();
  const ret = (await req('POST', '/api/purchase-returns', { supplierId: s.id, receiptId: r.id, lines: [{ productId: p.id, qty: 1, price: 1000 }] })).json();
  await req('POST', `/api/purchase-receipts/${r.id}/cancel`, {});
  const res = await req('POST', `/api/purchase-returns/${ret.id}/complete`, {});
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('RECEIPT_NOT_COMPLETED');
});
