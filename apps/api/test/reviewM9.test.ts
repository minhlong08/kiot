import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct, makeSupplier } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let limited: string;
const year = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 4);
const m = new Date(Date.now() + 7 * 3600_000).toISOString().slice(5, 7);
const all = 'from=2020-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z';
beforeAll(async () => {
  t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma);
  const role = await t.prisma.role.create({ data: { name: 'Thu ngân xem báo cáo', permissions: { create: ['dashboard.view', 'reports.view'].map(key => ({ key })) } } });
  await t.prisma.user.create({ data: { username: 'thungan2', fullName: 'Thu ngân', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId }] } } });
  limited = await t.login('thungan2', 'pass123');
});
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown, cookie = admin) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

test('dashboard today carries no cost or profit; login alerts are for admins only', async () => {
  const body = (await req('GET', '/api/dashboard/today', undefined, limited)).body;
  expect(body).not.toMatch(/"(cost|profit)"/);
  expect((await req('GET', '/api/dashboard/alerts', undefined, limited)).statusCode).toBe(403);
});

test('reports.view alone does not reveal salaries', async () => {
  expect((await req('GET', `/api/reports/staff-payroll?${all}`, undefined, limited)).statusCode).toBe(403);
});

test('a failed login with an unknown account never stores what was typed', async () => {
  await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'MatKhauBiMat123', password: 'x' } });
  const row = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'loginFailed' }, orderBy: { id: 'desc' } });
  expect(row.entityCode + row.summary).not.toContain('MatKhauBiMat123');
});

test('P&L uses each voucher\'s own P&L flag and counts unpaid service purchases in full', async () => {
  const exp = async () => (await req('GET', `/api/reports/finance-pnl?year=${year}`)).json().rows.find((r: { key: string }) => r.key === 'expenses')[`m${m}`];
  const base = await exp();
  const fund = (await t.prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } })).id;
  const cat = (await req('POST', '/api/cash-categories', { kind: 'out', name: 'Quảng cáo', affectsPnl: true })).json();
  await req('POST', '/api/cash-vouchers', { kind: 'out', fundId: fund, amount: 300_000, categoryId: cat.id, counterpartyType: 'other', counterpartyName: 'FB' });
  await req('PUT', `/api/cash-categories/${cat.id}`, { kind: 'out', name: 'Quảng cáo', affectsPnl: false });
  expect(await exp()).toBe(base + 300_000);
  const supplier = await makeSupplier(t.prisma, 'Điện lạnh Hà Thành');
  const sp = await req('POST', '/api/service-purchases', { supplierId: supplier.id, serviceName: 'Sửa điều hòa', amount: 1_000_000, paid: 400_000, fundId: fund });
  expect(sp.statusCode).toBe(200);
  expect(await exp()).toBe(base + 300_000 + 1_000_000);
});

test('orders-by-transaction leaves out cancelled orders', async () => {
  const p = await makeProduct(t.prisma, { price: 100_000, cost: 0 });
  const o = (await req('POST', '/api/customer-orders', { lines: [{ productId: p.id, qty: 1, price: 100_000 }], confirm: true })).json();
  await req('POST', `/api/customer-orders/${o.id}/cancel`, {});
  const r = (await req('GET', `/api/reports/orders-by-transaction?${all}`)).json();
  expect(r.rows.map((x: { code: string }) => x.code)).not.toContain(o.code);
});

test('fact reports filter by seller, channel and product group; end of day agrees with itself', async () => {
  const g = await t.prisma.productGroup.create({ data: { name: 'Nhóm lọc' } });
  const p = await makeProduct(t.prisma, { price: 100_000, cost: 0, groupId: g.id });
  const q = await makeProduct(t.prisma, { price: 100_000, cost: 0 });
  for (const x of [p, q]) await moveStock(t.prisma, { productId: x.id, branchId, qty: 10, unitCost: 1, docType: 'receipt', docId: x.id, docCode: 'PN' });
  await req('POST', '/api/invoices', { channel: 'facebook', lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] });
  await req('POST', '/api/invoices', { channel: 'store', lines: [{ productId: q.id, qty: 2, price: 100_000 }], payments: [{ method: 'cash', amount: 200_000 }] });
  const net = async (qs: string) => (await req('GET', `/api/reports/sales-by-time?${all}&${qs}`)).json().totals.net;
  expect(await net('channels=facebook')).toBe(100_000);
  expect(await net(`groupIds=${g.id}`)).toBe(100_000);
  const adminId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).id;
  expect(await net(`sellerIds=${adminId}`)).toBe(await net(''));
  expect(await net('sellerIds=999999')).toBe(0);
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const eod = (await req('GET', `/api/reports/end-of-day?date=${today}`)).json().rows;
  const v = (s: string, l?: string) => eod.filter((x: { section: string; label: string }) => x.section === s && (!l || x.label === l)).reduce((a: number, x: { amount: number }) => a + x.amount, 0);
  expect(v('Tổng quan', 'Doanh thu')).toBe(v('Nhân viên'));
});
