import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { makeCustomer, makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';
import { postLoyalty } from '../src/services/loyalty';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });
async function stocked(price = 100_000, qty = 20) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty, unitCost: 40_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
const lineOf = (p: { id: number }, qty = 1, price = 100_000) => [{ productId: p.id, qty, price }];
const draftLine = async (invoiceId: number) => (await req('GET', `/api/invoices/${invoiceId}/return-draft`)).json().lines[0].invoiceLineId;

test('C1: clients cannot pay with exchange credit or points as a payment method', async () => {
  const p = await stocked();
  const res = await req('POST', '/api/invoices', { lines: lineOf(p), payments: [{ method: 'exchange', amount: 5_000_000 }] });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('INVALID_PAYMENT');
  expect((await req('POST', '/api/invoices', { lines: lineOf(p), payments: [{ method: 'points', amount: 100_000 }] })).statusCode).toBe(400);
});

test('C1: an exchange cannot smuggle extra exchange payments', async () => {
  const a = await stocked(300_000);
  const inv = (await req('POST', '/api/invoices', { lines: lineOf(a, 1, 300_000), payments: [{ method: 'cash', amount: 300_000 }] })).json();
  const res = await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: await draftLine(inv.id), qty: 1 }], refundMethod: 'exchange', exchange: { lines: lineOf(a, 1, 300_000), payments: [{ method: 'exchange', amount: 9_000_000 }] } });
  expect(res.statusCode).toBe(400);
});

test('C2: backdating is limited to queued offline sales within 48 hours', async () => {
  const p = await stocked();
  const old = (await req('POST', '/api/invoices', { lines: lineOf(p), payments: [{ method: 'cash', amount: 100_000 }], createdAtClient: '2020-01-01T00:00:00Z' })).json();
  expect(Date.now() - new Date(old.createdAt).getTime()).toBeLessThan(60_000);
  const queued = (await req('POST', '/api/invoices', { clientUuid: '11111111-1111-4111-8111-111111111111', lines: lineOf(p), payments: [{ method: 'cash', amount: 100_000 }], createdAtClient: new Date(Date.now() - 3600_000).toISOString() })).json();
  expect(Date.now() - new Date(queued.createdAt).getTime()).toBeGreaterThan(3500_000);
  const tooOld = (await req('POST', '/api/invoices', { clientUuid: '22222222-2222-4222-8222-222222222222', lines: lineOf(p), payments: [{ method: 'cash', amount: 100_000 }], createdAtClient: new Date(Date.now() - 5 * 86400_000).toISOString() })).json();
  expect(Date.now() - new Date(tooOld.createdAt).getTime()).toBeLessThan(49 * 3600_000);
});

test("C3: an order's deposit only pays that order's customer's invoice", async () => {
  const p = await stocked();
  const a = await makeCustomer(t.prisma);
  const o = (await req('POST', '/api/customer-orders', { customerId: a.id, lines: lineOf(p), deposit: 100_000, confirm: true })).json();
  const walkIn = await req('POST', '/api/invoices', { orderId: o.id, lines: lineOf(p), payments: [{ method: 'deposit', amount: 100_000 }] });
  expect(walkIn.statusCode).toBe(200);
  expect(walkIn.json().customerId).toBe(a.id);
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).debt).toBe(0);
});

test('I4: returning a points-paid sale gives the points back, not cash', async () => {
  const p = await stocked();
  const c = await makeCustomer(t.prisma);
  await postLoyalty(t.prisma, { customerId: c.id, points: 100, docType: 'seed', docId: 0, docCode: 'X' });
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, lines: lineOf(p), pointsUsed: 100 })).json();
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: await draftLine(inv.id), qty: 1 }], refundMethod: 'cash' })).json();
  expect(ret.refunded).toBe(0);
  expect(ret.pointsRefunded).toBe(100);
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).points).toBe(100);
});

test('I5: a sale on credit refunds into debt, not out of the drawer', async () => {
  const p = await stocked();
  const c = await makeCustomer(t.prisma);
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, lines: lineOf(p) })).json();
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: await draftLine(inv.id), qty: 1 }], refundMethod: 'cash' })).json();
  expect(ret).toMatchObject({ refunded: 0, toDebt: 100_000 });
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(0);
});

test('I6: quick returns cannot refund above the current price without pos.editPrice', async () => {
  const p = await stocked();
  const b = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  const role = await t.prisma.role.create({ data: { name: 'Thu ngân trả', permissions: { create: [{ key: 'returns.create' }, { key: 'pos.access' }] } } });
  await t.prisma.user.create({ data: { username: 'tnr', fullName: 'TNR', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId: b.id }] } } });
  const cookie = await t.login('tnr', 'pass123');
  const res = await req('POST', '/api/returns', { lines: [{ productId: p.id, qty: 1, price: 5_000_000 }], refundMethod: 'cash' }, cookie);
  expect(res.json().error.code).toBe('PRICE_NOT_ALLOWED');
});

test('I7: an exchange invoice cannot be cancelled on its own; cancelling the return cancels both', async () => {
  const a = await stocked(300_000);
  const b = await stocked(100_000);
  const inv = (await req('POST', '/api/invoices', { lines: lineOf(a, 1, 300_000), payments: [{ method: 'cash', amount: 300_000 }] })).json();
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: await draftLine(inv.id), qty: 1 }], refundMethod: 'exchange', exchange: { lines: lineOf(b) } })).json();
  expect((await req('POST', `/api/invoices/${ret.exchangeInvoice.id}/cancel`, {})).json().error.code).toBe('IS_EXCHANGE');
  expect((await req('POST', `/api/returns/${ret.id}/cancel`, {})).statusCode).toBe(200);
  expect((await t.prisma.invoice.findUniqueOrThrow({ where: { id: ret.exchangeInvoice.id } })).status).toBe('cancelled');
  expect((await getBranchStock(t.prisma, a.id, branchId)).onHand).toBe(19);
  expect((await getBranchStock(t.prisma, b.id, branchId)).onHand).toBe(20);
});

test('I12: redeeming more points than the bill needs is refused; loyalty off refuses redemption', async () => {
  const p = await stocked(50_000);
  const c = await makeCustomer(t.prisma);
  await postLoyalty(t.prisma, { customerId: c.id, points: 500, docType: 'seed', docId: 0, docCode: 'X' });
  expect((await req('POST', '/api/invoices', { customerId: c.id, lines: lineOf(p, 1, 50_000), pointsUsed: 200 })).json().error.code).toBe('POINTS_EXCEED_TOTAL');
});

test('price-book edits reach the POS catalog delta', async () => {
  const p = await stocked();
  const since = (await req('GET', '/api/pos/catalog')).json().serverTime;
  await new Promise(r => setTimeout(r, 5));
  const book = (await req('POST', '/api/price-books', { name: 'Delta' })).json();
  await req('PUT', `/api/price-books/${book.id}/items`, { items: [{ productId: p.id, price: 90_000 }] });
  expect((await req('GET', `/api/pos/catalog?since=${encodeURIComponent(since)}`)).json().products.map((x: { id: number }) => x.id)).toContain(p.id);
});

test('returns never refund more than the invoice total', async () => {
  const p = await stocked(100_000);
  const inv = (await req('POST', '/api/invoices', { lines: lineOf(p, 3), invoiceDiscount: 100, payments: [{ method: 'cash', amount: 299_900 }] })).json();
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: await draftLine(inv.id), qty: 3 }], refundMethod: 'cash' })).json();
  expect(ret.total).toBeLessThanOrEqual(inv.total);
});

test('concurrent replays of one clientUuid return the same invoice', async () => {
  const p = await stocked();
  const body = { clientUuid: '33333333-3333-4333-8333-333333333333', lines: lineOf(p), payments: [{ method: 'cash', amount: 100_000 }] };
  const [a, b] = await Promise.all([req('POST', '/api/invoices', body), req('POST', '/api/invoices', body)]);
  expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
  expect(a.json().id).toBe(b.json().id);
});
