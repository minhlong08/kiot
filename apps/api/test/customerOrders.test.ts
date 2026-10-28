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
async function setup(qty = 3) {
  const p = await makeProduct(t.prisma, { price: 100_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 40_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  const c = await makeCustomer(t.prisma);
  const o = (await req('POST', '/api/customer-orders', { customerId: c.id, lines: [{ productId: p.id, qty, price: 100_000 }], deposit: 100_000, confirm: true })).json();
  return { p, c, o };
}
const debt = async (id: number) => (await t.prisma.customer.findUniqueOrThrow({ where: { id } })).debt;

test('confirming reserves stock and the deposit is a cash-in credit for the customer', async () => {
  const { p, c, o } = await setup();
  expect(o.code).toMatch(/^DH\d{6}$/);
  expect(o).toMatchObject({ status: 'confirmed', total: 300_000, deposit: 100_000 });
  expect((await getBranchStock(t.prisma, p.id, branchId)).reserved).toBe(3);
  expect(await debt(c.id)).toBe(-100_000);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'customerOrder', sourceId: o.id } });
  expect(v.code).toMatch(/^TTDH/);
});

test('invoicing the order uses the deposit, releases the reservation and completes it', async () => {
  const { p, c, o } = await setup();
  const draft = (await req('GET', `/api/customer-orders/${o.id}/invoice-draft`)).json();
  expect(draft).toMatchObject({ depositAvailable: 100_000, lines: [expect.objectContaining({ qty: 3 })] });
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, orderId: o.id, lines: draft.lines, payments: [{ method: 'deposit', amount: 100_000 }, { method: 'cash', amount: 200_000 }] })).json();
  expect(inv.status).toBe('completed');
  expect((await req('GET', `/api/customer-orders/${o.id}`)).json()).toMatchObject({ status: 'completed', depositUsed: 100_000 });
  expect(await getBranchStock(t.prisma, p.id, branchId)).toMatchObject({ onHand: 7, reserved: 0 });
  expect(await debt(c.id)).toBe(0);
});

test('partial fulfilment', async () => {
  const { p, c, o } = await setup(3);
  await req('POST', '/api/invoices', { customerId: c.id, orderId: o.id, lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'deposit', amount: 100_000 }] });
  const d = (await req('GET', `/api/customer-orders/${o.id}`)).json();
  expect(d.status).toBe('partial');
  expect((await getBranchStock(t.prisma, p.id, branchId)).reserved).toBe(2);
});

test('using more deposit than is left is refused', async () => {
  const { p, c, o } = await setup(3);
  const res = await req('POST', '/api/invoices', { customerId: c.id, orderId: o.id, lines: [{ productId: p.id, qty: 3, price: 100_000 }], payments: [{ method: 'deposit', amount: 150_000 }, { method: 'cash', amount: 150_000 }] });
  expect(res.json().error.code).toBe('DEPOSIT_EXCEEDED');
});

test('cancelling releases the reservation and leaves the deposit as customer credit', async () => {
  const { p, c, o } = await setup();
  expect((await req('POST', `/api/customer-orders/${o.id}/cancel`, {})).json().status).toBe('cancelled');
  expect((await getBranchStock(t.prisma, p.id, branchId)).reserved).toBe(0);
  expect(await debt(c.id)).toBe(-100_000);
});

test('cancelling the invoice rolls the order back to confirmed and reserves again', async () => {
  const { p, c, o } = await setup(2);
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, orderId: o.id, lines: [{ productId: p.id, qty: 2, price: 100_000 }], payments: [{ method: 'deposit', amount: 100_000 }, { method: 'cash', amount: 100_000 }] })).json();
  await req('POST', `/api/invoices/${inv.id}/cancel`, {});
  expect((await req('GET', `/api/customer-orders/${o.id}`)).json()).toMatchObject({ status: 'confirmed', depositUsed: 0 });
  expect((await getBranchStock(t.prisma, p.id, branchId)).reserved).toBe(2);
});
