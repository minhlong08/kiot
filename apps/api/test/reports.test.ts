import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';
import { readXlsx } from '../src/lib/excel';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
const all = 'from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z';
beforeAll(async () => {
  t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma);
  const p = await makeProduct(t.prisma, { name: 'Sơ mi trắng', price: 400_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 20, unitCost: 150_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  const sell = async (channel: string, at: string) => {
    const inv = (await req('POST', '/api/invoices', { channel, lines: [{ productId: p.id, qty: 1, price: 400_000 }], payments: [{ method: 'cash', amount: 400_000 }] })).json();
    await t.prisma.invoice.update({ where: { id: inv.id }, data: { createdAt: new Date(at) } });
  };
  await sell('store', '2026-10-27T17:30:00Z'); // 00:30 on the 28th, VN
  await sell('facebook', '2026-10-28T02:15:00Z'); // 09:15 VN
  await sell('store', '2026-10-28T02:45:00Z'); // 09:45 VN
});
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown, cookie = admin) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

test('sales by time buckets by Vietnam hour', async () => {
  const r = (await req('GET', `/api/reports/sales-by-time?${all}&by=hour`)).json();
  expect(r.rows.map((x: { key: string; net: number }) => [x.key, x.net])).toEqual([['00', 400_000], ['09', 800_000]]);
  expect(r.totals.net).toBe(1_200_000);
  expect(r.chart.labels).toEqual(['00h', '09h']);
});

test('channels add up to the total net revenue', async () => {
  const r = (await req('GET', `/api/reports/channels?${all}`)).json();
  expect(r.rows.map((x: { channel: string; net: number }) => [x.channel, x.net])).toEqual([['Cửa hàng', 800_000], ['Facebook', 400_000]]);
  expect(r.rows.reduce((s: number, x: { net: number }) => s + x.net, 0)).toBe(r.totals.net);
});

test('profit report: cost and profit for cost.view only — in the report and in the export', async () => {
  const full = (await req('GET', `/api/reports/sales-profit?${all}`)).json();
  expect(full.totals).toMatchObject({ revenue: 1_200_000, cost: 450_000, profit: 750_000 });
  const role = await t.prisma.role.create({ data: { name: 'Xem báo cáo', permissions: { create: [{ key: 'reports.view' }, { key: 'reports.export' }] } } });
  await t.prisma.user.create({ data: { username: 'baocao', fullName: 'B', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId }] } } });
  const cookie = await t.login('baocao', 'pass123');
  const limited = (await req('GET', `/api/reports/sales-profit?${all}`, undefined, cookie)).json();
  expect(limited.columns.map((c: { key: string }) => c.key)).not.toContain('cost');
  expect(JSON.stringify(limited)).not.toMatch(/"(cost|profit|margin)"/);
  const xlsx = await req('GET', `/api/reports/sales-profit/export?${all}`, undefined, cookie);
  expect(xlsx.statusCode).toBe(200);
  const sheet = await readXlsx(xlsx.rawPayload);
  expect(Object.keys(sheet[0])).toContain('Doanh thu');
  expect(Object.keys(sheet[0])).not.toContain('Giá vốn');
  expect((await req('GET', '/api/reports/no-such-report')).statusCode).toBe(404);
});
