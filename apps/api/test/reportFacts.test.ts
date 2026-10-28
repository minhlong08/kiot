import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeCustomer, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';
import { periodSummary, returnFacts, saleFacts } from '../src/services/reportFacts';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to), branchId });
async function product(price: number, cost: number) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 20, unitCost: cost, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}

test('line revenue (with invoice discount and points) sums to the invoice goods total; cost from the snapshot', async () => {
  const c = await makeCustomer(t.prisma, { name: 'Khách điểm' });
  await t.prisma.customer.update({ where: { id: c.id }, data: { points: 100 } });
  await t.prisma.loyaltyTransaction.create({ data: { customerId: c.id, points: 100, balanceAfter: 100, docType: 'test', docId: 0, docCode: 'T' } }).catch(() => undefined);
  const a = await product(300_000, 100_000), b = await product(100_000, 40_000);
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, invoiceDiscount: 40_000, pointsUsed: 10, lines: [{ productId: a.id, qty: 1, price: 300_000 }, { productId: b.id, qty: 2, price: 100_000 }], payments: [{ method: 'cash', amount: 450_000 }] })).json();
  expect(inv.total).toBe(460_000);
  const facts = (await saleFacts(t.prisma, range('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z'))).filter(f => f.invoiceId === inv.id);
  expect(facts.reduce((s, f) => s + f.revenue, 0)).toBe(460_000);
  expect(facts.map(f => f.cost)).toEqual([100_000, 80_000]);
  expect(facts.reduce((s, f) => s + f.discount, 0)).toBe(40_000);
});

test('a return dated next month counts there; a cancelled invoice counts nowhere', async () => {
  const p = await product(200_000, 50_000);
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 2, price: 200_000 }], payments: [{ method: 'cash', amount: 400_000 }] })).json();
  await t.prisma.invoice.update({ where: { id: inv.id }, data: { createdAt: new Date('2026-08-20T03:00:00Z') } });
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  const ret = (await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' })).json();
  await t.prisma.saleReturn.update({ where: { id: ret.id }, data: { createdAt: new Date('2026-09-05T03:00:00Z') } });
  const aug = await periodSummary(t.prisma, range('2026-07-31T17:00:00Z', '2026-08-31T17:00:00Z'));
  const sep = await periodSummary(t.prisma, range('2026-08-31T17:00:00Z', '2026-09-30T17:00:00Z'));
  expect([aug.revenue, aug.returns, aug.net, aug.cost, aug.profit]).toEqual([400_000, 0, 400_000, 100_000, 300_000]);
  expect([sep.revenue, sep.returns, sep.net, sep.cost]).toEqual([0, 200_000, -200_000, -50_000]);
  expect((await returnFacts(t.prisma, range('2026-08-31T17:00:00Z', '2026-09-30T17:00:00Z')))[0]).toMatchObject({ qty: -1, revenue: -200_000, cost: -50_000 });

  const gone = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 200_000 }], payments: [{ method: 'cash', amount: 200_000 }] })).json();
  await t.prisma.invoice.update({ where: { id: gone.id }, data: { createdAt: new Date('2026-08-21T03:00:00Z') } });
  await req('POST', `/api/invoices/${gone.id}/cancel`, {});
  expect((await periodSummary(t.prisma, range('2026-07-31T17:00:00Z', '2026-08-31T17:00:00Z'))).revenue).toBe(400_000);
});
