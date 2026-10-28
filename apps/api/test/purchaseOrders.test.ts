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

async function order(qty = 10, confirm = true) {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const o = (await req('POST', '/api/purchase-orders', { supplierId: s.id, lines: [{ productId: p.id, qty, unitCost: 50_000 }], confirm })).json();
  return { s, p, o };
}

test('confirming raises incoming and totals are computed', async () => {
  const { p, o } = await order(10);
  expect(o.code).toMatch(/^PDN\d{6}$/);
  expect(o).toMatchObject({ status: 'confirmed', subtotal: 500_000, total: 500_000 });
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(10);
});

test('a draft does not raise incoming until confirmed', async () => {
  const { p, o } = await order(4, false);
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(0);
  await req('POST', `/api/purchase-orders/${o.id}/confirm`, {});
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(4);
});

test('cancel releases incoming', async () => {
  const { p, o } = await order(6);
  const c = (await req('POST', `/api/purchase-orders/${o.id}/cancel`, {})).json();
  expect(c.status).toBe('cancelled');
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(0);
});

test('receipt-draft returns remaining lines and close releases the remainder', async () => {
  const { s, p, o } = await order(10);
  await req('POST', '/api/purchase-receipts', { supplierId: s.id, purchaseOrderId: o.id, lines: [{ productId: p.id, qty: 4, unitCost: 50_000 }], complete: true });
  const draft = (await req('GET', `/api/purchase-orders/${o.id}/receipt-draft`)).json();
  expect(draft.lines[0]).toMatchObject({ productId: p.id, qty: 6, unitCost: 50_000 });
  expect((await req('GET', `/api/purchase-orders/${o.id}`)).json().status).toBe('partial');
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(6);
  await req('POST', `/api/purchase-orders/${o.id}/close`, {});
  expect((await req('GET', `/api/purchase-orders/${o.id}`)).json().status).toBe('completed');
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(0);
});

test('receiving more than ordered completes the order and incoming never goes negative', async () => {
  const { s, p, o } = await order(3);
  await req('POST', '/api/purchase-receipts', { supplierId: s.id, purchaseOrderId: o.id, lines: [{ productId: p.id, qty: 5, unitCost: 50_000 }], complete: true });
  expect((await req('GET', `/api/purchase-orders/${o.id}`)).json().status).toBe('completed');
  expect((await getBranchStock(t.prisma, p.id, branchId)).incoming).toBe(0);
});
