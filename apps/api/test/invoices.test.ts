import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { makeCustomer, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });
async function stocked(price = 100_000) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 20, unitCost: 40_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}

test('POST /api/invoices sells and the list shows it with totals', async () => {
  const p = await stocked();
  const c = await makeCustomer(t.prisma, { name: 'Khách hóa đơn' });
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, lines: [{ productId: p.id, qty: 2, price: 100_000 }], payments: [{ method: 'cash', amount: 200_000 }] })).json();
  expect(inv.code).toMatch(/^HD/);
  const list = (await req('GET', '/api/invoices?status=completed')).json();
  expect(list.items[0]).toMatchObject({ code: inv.code, customerName: 'Khách hóa đơn', total: 200_000 });
  expect(list.totals.total).toBeGreaterThanOrEqual(200_000);
});

test('detail has lines with product info and payments with voucher codes', async () => {
  const p = await stocked();
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] })).json();
  const d = (await req('GET', `/api/invoices/${inv.id}`)).json();
  expect(d.lines[0]).toMatchObject({ productCode: p.code, qty: 1, amount: 100_000 });
  expect(d.payments[0].voucherCode).toMatch(/^TTHD/);
});

test('cost fields are hidden without cost.view', async () => {
  const role = await t.prisma.role.create({ data: { name: 'Thu ngân xem', permissions: { create: [{ key: 'invoices.view' }] } } });
  await t.prisma.user.create({ data: { username: 'tn', fullName: 'TN', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId }] } } });
  const cookie = await t.login('tn', 'pass123');
  const list = (await req('GET', '/api/invoices', undefined, cookie)).json();
  expect(list.items[0].costTotal).toBeUndefined();
  const d = (await req('GET', `/api/invoices/${list.items[0].id}`, undefined, cookie)).json();
  expect(d.costTotal).toBeUndefined();
  expect(d.lines[0].cost).toBeUndefined();
});

test('cancel through the API and the status filter', async () => {
  const p = await stocked();
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] })).json();
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).json().status).toBe('cancelled');
  const cancelled = (await req('GET', '/api/invoices?status=cancelled')).json();
  expect(cancelled.items.map((i: { id: number }) => i.id)).toContain(inv.id);
});

test('print data and copy draft', async () => {
  const p = await stocked();
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 150_000 }] })).json();
  const pr = (await req('GET', `/api/invoices/${inv.id}/print`)).json();
  expect(pr).toMatchObject({ code: inv.code, total: 100_000, change: 50_000, store: { name: expect.any(String) } });
  const copy = (await req('GET', `/api/invoices/${inv.id}/copy`)).json();
  expect(copy.lines[0]).toMatchObject({ productId: p.id, qty: 1, price: 100_000 });
});

test('customer history lists their invoices', async () => {
  const p = await stocked();
  const c = await makeCustomer(t.prisma);
  await req('POST', '/api/invoices', { customerId: c.id, lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  const h = (await req('GET', `/api/customers/${c.id}/history`)).json();
  expect(h[0]).toMatchObject({ type: 'invoice', total: 100_000 });
});

test('export is xlsx', async () => {
  expect((await req('GET', '/api/invoices/export')).headers['content-type']).toContain('spreadsheetml');
});
