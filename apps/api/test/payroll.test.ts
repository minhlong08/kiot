import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
const vnToday = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const from = `${vnToday.slice(0, 8)}01`;
const to = (() => { const d = new Date(`${from}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
const day2 = `${vnToday.slice(0, 8)}02`;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

let periodId: number;
let sellerSheet: { id: number; total: number };

test('a period generates paysheets from timesheets and commissions (returns netted); no linked user → no commission', async () => {
  const userId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).id;
  const tpl = (await req('POST', '/api/salary-templates', { name: 'Theo ca', mode: 'perShift', amount: 200_000, allowances: [{ name: 'Gửi xe', amount: 100_000, per: 'month' }] })).json();
  const table = (await req('POST', '/api/commission-tables', { name: '2%', rules: [{ scope: 'all', refId: null, type: 'percent', value: 2 }] })).json();
  const seller = (await req('POST', '/api/employees', { name: 'Người bán', branchId, userId, salaryTemplateId: tpl.id, commissionTableId: table.id })).json();
  const helper = (await req('POST', '/api/employees', { name: 'Phụ kho', branchId, salaryTemplateId: tpl.id, commissionTableId: table.id })).json();
  await req('POST', '/api/employees', { name: 'Không mẫu lương', branchId });
  const shift = (await req('POST', '/api/work-shifts', { name: 'Ca', start: '08:00', end: '16:00' })).json();
  for (const e of [seller, helper]) for (const d of [from, day2]) {
    await req('POST', '/api/schedule', { employeeId: e.id, shiftId: shift.id, date: d });
    await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: shift.id, date: d, status: 'present' });
  }
  const p = await makeProduct(t.prisma, { price: 500_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 5, unitCost: 1, docType: 'receipt', docId: p.id, docCode: 'PN' });
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 2, price: 500_000 }], payments: [{ method: 'cash', amount: 1_000_000 }] })).json();
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' });

  const period = (await req('POST', '/api/payroll-periods', { name: 'Lương tháng này', from, to })).json();
  periodId = period.id;
  expect(period.code).toMatch(/^BL\d{6}$/);
  const sheets = (await req('GET', `/api/payroll-periods/${period.id}`)).json().paysheets;
  expect(sheets).toHaveLength(2);
  const s = sheets.find((x: { employeeId: number }) => x.employeeId === seller.id);
  expect([s.base, s.allowance, s.commission, s.total]).toEqual([400_000, 100_000, 10_000, 510_000]);
  expect(sheets.find((x: { employeeId: number }) => x.employeeId === helper.id).commission).toBe(0);
  sellerSheet = s;
});

test('bonus in draft recomputes; regenerating or editing a locked period → 409; pay needs the period locked', async () => {
  expect((await req('PUT', `/api/paysheets/${sellerSheet.id}`, { bonus: 90_000, note: 'Thưởng doanh số' })).json().total).toBe(600_000);
  expect((await req('POST', `/api/paysheets/${sellerSheet.id}/pay`, { amount: 100_000 })).json().error.code).toBe('PERIOD_NOT_LOCKED');
  expect((await req('POST', `/api/payroll-periods/${periodId}/regenerate`, {})).statusCode).toBe(200);
  // Regenerating keeps manually entered bonuses and notes.
  expect((await req('GET', `/api/payroll-periods/${periodId}`)).json().paysheets.find((x: { id: number }) => x.id === sellerSheet.id)).toMatchObject({ bonus: 90_000, total: 600_000 });
  expect((await req('POST', `/api/payroll-periods/${periodId}/lock`, {})).json().status).toBe('locked');
  expect((await req('POST', `/api/payroll-periods/${periodId}/regenerate`, {})).json().error.code).toBe('PERIOD_LOCKED');
  expect((await req('PUT', `/api/paysheets/${sellerSheet.id}`, { bonus: 1 })).json().error.code).toBe('PERIOD_LOCKED');
});

test('concurrent full payments never exceed the total; payment is a "Chi lương" voucher to the employee; a paid period cannot be cancelled', async () => {
  const sheet = (await req('GET', `/api/payroll-periods/${periodId}`)).json().paysheets.find((x: { id: number }) => x.id === sellerSheet.id);
  const res = await Promise.all([1, 2].map(() => req('POST', `/api/paysheets/${sheet.id}/pay`, { amount: sheet.total })));
  expect(res.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const after = await t.prisma.paysheet.findUniqueOrThrow({ where: { id: sheet.id } });
  expect(after.paid).toBe(sheet.total);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'payroll', sourceId: sheet.id } });
  const cat = await t.prisma.cashCategory.findUniqueOrThrow({ where: { id: v.categoryId } });
  expect([v.kind, v.amount, v.counterpartyType, cat.name]).toEqual(['out', sheet.total, 'employee', 'Chi lương']);
  expect((await req('POST', `/api/payroll-periods/${periodId}/cancel`, {})).json().error.code).toBe('PERIOD_PAID');
});
