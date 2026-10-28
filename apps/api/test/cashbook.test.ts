import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { makeCustomer } from './factories';
import { postPartnerLedger } from '../src/services/partnerLedger';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let cashFundId: number;
let catOut: number;
let catIn: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  cashFundId = (await t.prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } })).id;
  catOut = (await t.prisma.cashCategory.findFirstOrThrow({ where: { kind: 'out', name: 'Chi khác' } })).id;
  catIn = (await t.prisma.cashCategory.findFirstOrThrow({ where: { kind: 'in', name: 'Thu tiền khách trả' } })).id;
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

test('funds: a bank fund with opening balance reports its balance; a used fund is deactivated, not deleted', async () => {
  const bank = (await req('POST', '/api/cash-funds', { type: 'bank', name: 'Vietcombank', bankName: 'VCB', bankBin: '970436', accountNumber: '0011', accountName: 'PD', openingBalance: 5_000_000 })).json();
  expect((await req('GET', '/api/cash-funds?all=1')).json().find((f: { id: number }) => f.id === bank.id).balance).toBe(5_000_000);
  await req('POST', '/api/cash-vouchers', { kind: 'in', fundId: bank.id, amount: 1000, categoryId: catIn, counterpartyType: 'other', counterpartyName: 'X' });
  expect((await req('DELETE', `/api/cash-funds/${bank.id}`)).json()).toEqual({ deactivated: true });
});

test('system categories are locked; user categories are editable', async () => {
  expect((await req('DELETE', `/api/cash-categories/${catOut}`)).json().error.code).toBe('SYSTEM_CATEGORY');
  const c = (await req('POST', '/api/cash-categories', { kind: 'out', name: 'Chi phí điện nước', affectsPnl: true })).json();
  expect((await req('PUT', `/api/cash-categories/${c.id}`, { kind: 'out', name: 'Điện nước', affectsPnl: true })).json().name).toBe('Điện nước');
});

test('summary: a voucher exactly at `from` is in the period; cancelled vouchers never count', async () => {
  const from = '2026-09-01T00:00:00.000Z';
  await req('POST', '/api/cash-vouchers', { kind: 'in', fundId: cashFundId, amount: 300_000, categoryId: catIn, counterpartyType: 'other', counterpartyName: 'A', at: '2026-08-31T23:00:00.000Z' });
  await req('POST', '/api/cash-vouchers', { kind: 'in', fundId: cashFundId, amount: 200_000, categoryId: catIn, counterpartyType: 'other', counterpartyName: 'B', at: from });
  const out = (await req('POST', '/api/cash-vouchers', { kind: 'out', fundId: cashFundId, amount: 50_000, categoryId: catOut, counterpartyType: 'other', counterpartyName: 'C', at: '2026-09-02T00:00:00.000Z' })).json();
  expect(out.code).toMatch(/^PC\d{6}$/);
  const cancelled = (await req('POST', '/api/cash-vouchers', { kind: 'out', fundId: cashFundId, amount: 999, categoryId: catOut, counterpartyType: 'other', counterpartyName: 'D', at: '2026-09-03T00:00:00.000Z' })).json();
  await req('POST', `/api/cash-vouchers/${cancelled.id}/cancel`, {});
  const r = (await req('GET', `/api/cash-vouchers?fundIds=${cashFundId}&from=${from}&to=2026-10-01T00:00:00.000Z`)).json();
  expect(r.summary).toEqual({ opening: 300_000, in: 200_000, out: 50_000, closing: 450_000 });
  expect(r.items.map((v: { status: string }) => v.status)).not.toContain('cancelled');
});

test('a manual receipt that settles customer debt, and its cancellation', async () => {
  const c = await makeCustomer(t.prisma);
  await postPartnerLedger(t.prisma, { partnerType: 'customer', partnerId: c.id, amount: 400_000, docType: 'invoice', docId: 1, docCode: 'HD1' });
  const v = (await req('POST', '/api/cash-vouchers', { kind: 'in', fundId: cashFundId, amount: 400_000, categoryId: catIn, counterpartyType: 'customer', counterpartyId: c.id, counterpartyName: c.name, postToDebt: true })).json();
  expect(v.code).toMatch(/^PT\d{6}$/);
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(0);
  await req('POST', `/api/cash-vouchers/${v.id}/cancel`, {});
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(400_000);
});

test('auto vouchers cannot be cancelled here', async () => {
  const v = await t.prisma.cashVoucher.create({ data: { code: 'TTHD999999', kind: 'in', fundId: cashFundId, branchId: 1, amount: 1, categoryId: catIn, counterpartyType: 'other', sourceType: 'invoice', sourceId: 1, sourceCode: 'HD1', createdById: 1 } });
  expect((await req('POST', `/api/cash-vouchers/${v.id}/cancel`, {})).json().error.code).toBe('AUTO_VOUCHER');
});

test('transfers create a voucher pair; funds of another branch are refused', async () => {
  const bank = (await req('POST', '/api/cash-funds', { type: 'bank', name: 'BIDV', accountNumber: '9' })).json();
  const r = (await req('POST', '/api/cash-vouchers/transfer', { fromFundId: cashFundId, toFundId: bank.id, amount: 1_000_000, note: 'Nộp tiền' })).json();
  expect(r.out.kind).toBe('out');
  expect(r.in).toMatchObject({ kind: 'in', fundId: bank.id, amount: 1_000_000 });
  const other = await t.prisma.branch.create({ data: { code: 'CNX', name: 'X' } });
  const foreign = await t.prisma.cashFund.create({ data: { type: 'bank', name: 'Khác', branchId: other.id } });
  expect((await req('POST', '/api/cash-vouchers/transfer', { fromFundId: cashFundId, toFundId: foreign.id, amount: 1 })).statusCode).toBe(404);
});

test('without cashbook.view nothing is visible, including export', async () => {
  const b = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  const role = await t.prisma.role.create({ data: { name: 'Không sổ quỹ', permissions: { create: [{ key: 'invoices.view' }] } } });
  await t.prisma.user.create({ data: { username: 'nocash', fullName: 'N', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId: b.id }] } } });
  const cookie = await t.login('nocash', 'pass123');
  expect((await req('GET', '/api/cash-vouchers', undefined, cookie)).statusCode).toBe(403);
  expect((await req('GET', '/api/cash-vouchers/export', undefined, cookie)).statusCode).toBe(403);
});

test('print data has the amount in words', async () => {
  const v = (await req('POST', '/api/cash-vouchers', { kind: 'out', fundId: cashFundId, amount: 1_200_000, categoryId: catOut, counterpartyType: 'other', counterpartyName: 'Điện lực' })).json();
  expect((await req('GET', `/api/cash-vouchers/${v.id}/print`)).json().amountInWords).toBe('Một triệu hai trăm nghìn đồng');
});
