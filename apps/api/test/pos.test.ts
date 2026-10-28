import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('bootstrap has settings, user limits, funds and channels', async () => {
  const b = (await req('GET', '/api/pos/bootstrap')).json();
  expect(b.user).toMatchObject({ isAdmin: true, maxDiscountPercent: 100 });
  expect(b.funds.length).toBeGreaterThan(0);
  expect(b.channels.map((c: { code: string }) => c.code)).toContain('store');
  expect(b.settings.customers.vndPerPoint).toBe(10000);
});

test('catalog returns sellable products with stock and only changes after `since`', async () => {
  const p = await makeProduct(t.prisma, { price: 123_000 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 4, unitCost: 1, docType: 'receipt', docId: 1, docCode: 'X' });
  const full = (await req('GET', '/api/pos/catalog')).json();
  expect(full.products.find((x: { id: number }) => x.id === p.id)).toMatchObject({ price: 123_000, onHand: 4 });
  const since = full.serverTime;
  await new Promise(r => setTimeout(r, 5));
  const q = await makeProduct(t.prisma, { price: 5 });
  const delta = (await req('GET', `/api/pos/catalog?since=${encodeURIComponent(since)}`)).json();
  expect(delta.products.map((x: { id: number }) => x.id)).toEqual([q.id]);
});

test('stock changes make a product show up in the delta', async () => {
  const p = await makeProduct(t.prisma);
  const since = (await req('GET', '/api/pos/catalog')).json().serverTime;
  await new Promise(r => setTimeout(r, 5));
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 2, unitCost: 1, docType: 'receipt', docId: 2, docCode: 'X' });
  const delta = (await req('GET', `/api/pos/catalog?since=${encodeURIComponent(since)}`)).json();
  expect(delta.products.map((x: { id: number }) => x.id)).toContain(p.id);
});

test('one open shift per user; closing computes expected cash', async () => {
  const s = (await req('POST', '/api/shifts/open', { openingCash: 500_000 })).json();
  expect((await req('POST', '/api/shifts/open', { openingCash: 1 })).json().error.code).toBe('SHIFT_OPEN');
  const p = await makeProduct(t.prisma, { price: 200_000 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 5, unitCost: 1, docType: 'receipt', docId: 3, docCode: 'X' });
  await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 200_000 }], payments: [{ method: 'cash', amount: 200_000 }] });
  expect((await req('GET', '/api/shifts/current')).json().id).toBe(s.id);
  const closed = (await req('POST', `/api/shifts/${s.id}/close`, { countedCash: 690_000 })).json();
  expect(closed).toMatchObject({ expectedCash: 700_000, countedCash: 690_000 });
  const report = (await req('GET', `/api/shifts/${s.id}/report`)).json();
  expect(report).toMatchObject({ invoiceCount: 1, salesTotal: 200_000, byMethod: { cash: 200_000 }, difference: -10_000 });
});
