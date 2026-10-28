import { afterAll, beforeAll, expect, test } from 'vitest';
import { sameTimeLastMonth } from '@pd/shared';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('today vs the same time last month; top products; staff; activity', async () => {
  const p = await makeProduct(t.prisma, { name: 'Áo vest xám', price: 1_000_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 1, docType: 'receipt', docId: p.id, docCode: 'PN' });
  const sell = async (qty: number) => (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty, price: 1_000_000 }], payments: [{ method: 'cash', amount: qty * 1_000_000 }] })).json();
  await sell(2);
  const before = await sell(1), after = await sell(1);
  const now = Date.now();
  const lm = sameTimeLastMonth(new Date(now)).getTime();
  // Last month: one sale an hour before "now" (counts), one an hour after (does not).
  await t.prisma.invoice.update({ where: { id: before.id }, data: { createdAt: new Date(lm - 3600_000) } });
  await t.prisma.invoice.update({ where: { id: after.id }, data: { createdAt: new Date(lm + 3600_000) } });
  const today = (await req('GET', '/api/dashboard/today')).json();
  expect([today.revenue, today.invoiceCount, today.previous.net, today.change.net]).toEqual([2_000_000, 1, lm - 3600_000 >= new Date(new Date(lm + 7 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00+07:00').getTime() ? 1_000_000 : 0, today.previous.net ? 100 : null]);
  const top = (await req('GET', '/api/dashboard/top-products?period=today&metric=qty')).json();
  expect(top[0]).toMatchObject({ name: 'Áo vest xám', value: 2 });
  const chart = (await req('GET', '/api/dashboard/chart?period=thisMonth&by=weekday')).json();
  expect(chart.labels).toHaveLength(7);
  expect((await req('GET', '/api/dashboard/staff?period=today')).json()[0]).toMatchObject({ name: 'Quản trị viên', net: 2_000_000 });
  expect((await req('GET', '/api/dashboard/activity')).json().some((a: { text: string }) => a.text.includes('vừa bán đơn hàng'))).toBe(true);
});

test('three failed logins for one account raise an alert', async () => {
  for (let i = 0; i < 3; i++) await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'admin', password: 'sai-mat-khau' } });
  const alerts = (await req('GET', '/api/dashboard/alerts')).json();
  expect(alerts.some((a: { kind: string; username: string; count: number }) => a.kind === 'failedLogins' && a.username === 'admin' && a.count >= 3)).toBe(true);
});
