import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin } });
const stocked = async (name: string) => {
  const p = await makeProduct(t.prisma, { name, price: 100_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 40_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
};
const sellAt = async (productId: number, at: string) => {
  const inv = (await t.app.inject({ method: 'POST', url: '/api/invoices', headers: { cookie: admin }, payload: { lines: [{ productId, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] } })).json();
  await t.prisma.invoice.update({ where: { id: inv.id }, data: { createdAt: new Date(at) } });
};

test('business KPIs compare with the period of equal length right before', async () => {
  const p = await stocked('Áo phân tích');
  await sellAt(p.id, '2026-10-05T03:00:00Z'); // current: Oct 1–11
  await sellAt(p.id, '2026-10-06T03:00:00Z');
  await sellAt(p.id, '2026-09-25T03:00:00Z'); // previous: Sep 21–Oct 1
  await sellAt(p.id, '2026-09-10T03:00:00Z'); // outside both
  const r = (await req('GET', '/api/analytics/business?from=2026-10-01T00:00:00.000Z&to=2026-10-11T00:00:00.000Z')).json();
  const net = r.kpis.find((k: { key: string }) => k.key === 'net');
  expect([net.value, net.previous, net.change]).toEqual([200_000, 100_000, 100]);
  expect(r.trend.labels).toHaveLength(10);
});

test('slow movers: stock on hand with no sale in the last 30 days', async () => {
  const sold = await stocked('Bán gần đây'), idle = await stocked('Nằm kho');
  await sellAt(sold.id, new Date(Date.now() - 5 * 86400_000).toISOString());
  await sellAt(idle.id, new Date(Date.now() - 45 * 86400_000).toISOString());
  const r = (await req('GET', '/api/analytics/products?from=2026-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z')).json();
  const names = r.slowMovers.map((x: { name: string }) => x.name);
  expect(names).toContain('Nằm kho');
  expect(names).not.toContain('Bán gần đây');
  expect(['A', 'B', 'C']).toContain(r.abc[0].cls);
});
