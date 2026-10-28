import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, multipart } from './helpers';
import { makeProduct, makeSupplier } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';
import { buildXlsx } from '../src/lib/excel';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const debt = async (id: number) => (await t.prisma.supplier.findUniqueOrThrow({ where: { id } })).debt;

test('completing raises stock, averages cost, books debt and a TTPN voucher', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, docType: 'opening', docId: p.id, docCode: 'X' });
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 10, unitCost: 120_000 }], paid: 500_000, complete: true })).json();
  expect(r).toMatchObject({ status: 'completed', total: 1_200_000, paid: 500_000 });
  expect(r.code).toMatch(/^PN\d{6}$/);
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 20, cost: 110_000 });
  expect(await debt(s.id)).toBe(700_000);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'receipt', sourceId: r.id } });
  expect(v.code).toMatch(/^TTPN\d{6}$/);
  expect(v.amount).toBe(500_000);
});

test('order discount and other costs flow into cost', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 2, unitCost: 100_000 }], discount: 40_000, otherCosts: 20_000, complete: true });
  expect((await getBranchStock(t.prisma, p.id, branchId)).cost).toBe(90_000);
  expect(await debt(s.id)).toBe(180_000);
});

test('a receipt in boxes of 6 adds 6 per box and divides cost', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  const unit = await t.prisma.productUnit.create({ data: { productId: p.id, name: 'hộp', conversion: 6, code: `${p.code}-H`, price: 1 } });
  await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, unitId: unit.id, qty: 2, unitCost: 600_000 }], complete: true });
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 12, cost: 100_000 });
});

test('a unit of another product is refused', async () => {
  const s = await makeSupplier(t.prisma);
  const a = await makeProduct(t.prisma);
  const b = await makeProduct(t.prisma);
  const unit = await t.prisma.productUnit.create({ data: { productId: b.id, name: 'hộp', conversion: 6, code: `${b.code}-H`, price: 1 } });
  expect((await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: a.id, unitId: unit.id, qty: 1, unitCost: 1 }] })).statusCode).toBe(400);
});

test('paying more than the total is refused', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const res = await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 100 }], paid: 200, complete: true });
  expect(res.statusCode).toBe(400);
});

test('cancelling after the goods were sold is refused without negative stock', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 5, unitCost: 10_000 }], complete: true })).json();
  await moveStock(t.prisma, { productId: p.id, branchId, qty: -3, docType: 'invoice', docId: 1, docCode: 'HD1' });
  const res = await req('POST', `/api/purchase-receipts/${r.id}/cancel`, {});
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');
});

test('cancelling restores stock, cost, debt and cancels the voucher', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma, { cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, docType: 'opening', docId: p.id, docCode: 'X' });
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 10, unitCost: 120_000 }], paid: 200_000, complete: true })).json();
  const c = (await req('POST', `/api/purchase-receipts/${r.id}/cancel`, {})).json();
  expect(c.status).toBe('cancelled');
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 10, cost: 100_000 });
  expect(await debt(s.id)).toBe(0);
  expect((await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'receipt', sourceId: r.id } })).status).toBe('cancelled');
});

test('draft can be edited, then completed', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const d = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 10 }] })).json();
  expect(d.status).toBe('draft');
  await req('PUT', `/api/purchase-receipts/${d.id}`, { supplierId: s.id, lines: [{ productId: p.id, qty: 3, unitCost: 10 }] });
  await req('POST', `/api/purchase-receipts/${d.id}/complete`, {});
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(3);
});

test('lines import resolves codes and reports unknown ones', async () => {
  const p = await makeProduct(t.prisma, { code: 'IMPL1' });
  const buf = await buildXlsx([{ header: 'Mã hàng', key: 'code' }, { header: 'Số lượng', key: 'qty' }, { header: 'Đơn giá', key: 'cost' }, { header: 'Giảm giá', key: 'disc' }], [{ code: 'IMPL1', qty: 2, cost: 1000 }, { code: 'NOPE', qty: 1, cost: 1 }]);
  const mp = multipart('file', 'l.xlsx', buf);
  const res = (await t.app.inject({ method: 'POST', url: '/api/purchase-receipts/lines-import', headers: { cookie: admin, ...mp.headers }, payload: mp.payload })).json();
  expect(res.lines).toEqual([expect.objectContaining({ productId: p.id, qty: 2, unitCost: 1000 })]);
  expect(res.errors).toEqual([expect.objectContaining({ row: 3 })]);
});

test('list filters by supplier and shows debt per receipt', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 1000 }], paid: 400, complete: true });
  const list = (await req('GET', `/api/purchase-receipts?supplierIds=${s.id}&status=completed`)).json();
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({ total: 1000, paid: 400, debt: 600, supplierName: s.name });
});
