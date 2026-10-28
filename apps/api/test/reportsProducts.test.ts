import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeCustomer, makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let pid: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('xuất nhập tồn: opening + in − out = closing for any window, matching the stock card', async () => {
  const p = await makeProduct(t.prisma, { name: 'Giày tây đen', price: 900_000, cost: 0 });
  pid = p.id;
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 400_000, docType: 'receipt', docId: 1, docCode: 'PN1' });
  await t.prisma.stockLedger.updateMany({ where: { productId: p.id }, data: { createdAt: new Date('2026-09-10T03:00:00Z') } });
  const c = await makeCustomer(t.prisma, { name: 'Khách giày' });
  const inv = (await req('POST', '/api/invoices', { customerId: c.id, lines: [{ productId: p.id, qty: 3, price: 900_000 }], payments: [{ method: 'cash', amount: 2_000_000 }] })).json();
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'debt' });

  const now = new Date(Date.now() + 60_000).toISOString();
  const r = (await req('GET', `/api/reports/stock-movement?from=2026-10-01T00:00:00.000Z&to=${now}`)).json();
  const row = r.rows.find((x: { productId: number }) => x.productId === p.id);
  expect([row.opening, row.inQty, row.outQty, row.closing]).toEqual([10, 1, 3, 8]);
  expect(row.opening + row.inQty - row.outQty).toBe(row.closing);
  expect(row.closing).toBe((await getBranchStock(t.prisma, p.id, branchId)).onHand);
  const early = (await req('GET', '/api/reports/stock-movement?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z')).json().rows.find((x: { productId: number }) => x.productId === p.id);
  expect([early.opening, early.inQty, early.closing]).toEqual([0, 10, 10]);

  // Customer debt: opening + increase − decrease = closing = cached debt.
  const debt = (await req('GET', `/api/reports/customers-debt?from=2026-01-01T00:00:00.000Z&to=${now}`)).json().rows.find((x: { name: string }) => x.name === 'Khách giày');
  expect(debt.closing).toBe((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt);
  expect(debt.opening + debt.increase - debt.decrease).toBe(debt.closing);
});

test('stock value equals Σ on hand × cost; product sales nets returns', async () => {
  const r = (await req('GET', '/api/reports/stock-value')).json();
  const stock = await t.prisma.branchStock.findMany({ where: { branchId } });
  expect(r.totals.value).toBe(stock.reduce((s, x) => s + x.onHand * x.cost, 0));
  const sales = (await req('GET', `/api/reports/products-sales?from=2026-10-01T00:00:00.000Z&to=${new Date(Date.now() + 60_000).toISOString()}`)).json().rows.find((x: { productId: number }) => x.productId === pid);
  expect([sales.soldQty, sales.returnedQty, sales.net]).toEqual([3, 1, 1_800_000]);
});
