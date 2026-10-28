import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, multipart } from './helpers';
import { buildXlsx } from '../src/lib/excel';
import { SUPPLIER_IMPORT_COLUMNS } from '../src/services/suppliers';
import { postPartnerLedger } from '../src/services/partnerLedger';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('creates a supplier with an automatic code and audit', async () => {
  const s = (await req('POST', '/api/suppliers', { name: 'Công ty May Việt', phone: '0281234567' })).json();
  expect(s.code).toMatch(/^NCC\d{6}$/);
  expect(await t.prisma.auditLog.count({ where: { entity: 'Supplier', action: 'create' } })).toBe(1);
});

test('search ignores diacritics', async () => {
  const list = (await req('GET', '/api/suppliers?search=cong%20ty%20may')).json();
  expect(list.items.map((s: { name: string }) => s.name)).toContain('Công ty May Việt');
});

test('debt filter and totals', async () => {
  const s = (await req('POST', '/api/suppliers', { name: 'Nợ nhiều' })).json();
  await postPartnerLedger(t.prisma, { partnerType: 'supplier', partnerId: s.id, amount: 5_000_000, docType: 'receipt', docId: 1, docCode: 'PN1' });
  const list = (await req('GET', '/api/suppliers?debtFrom=1000000')).json();
  expect(list.items.map((x: { id: number }) => x.id)).toEqual([s.id]);
  expect(list.totals.debt).toBe(5_000_000);
});

test('paying more than the debt makes the debt negative and writes a TTNCC voucher', async () => {
  const s = (await req('POST', '/api/suppliers', { name: 'Trả dư' })).json();
  await postPartnerLedger(t.prisma, { partnerType: 'supplier', partnerId: s.id, amount: 1_000_000, docType: 'receipt', docId: 2, docCode: 'PN2' });
  const res = await req('POST', `/api/suppliers/${s.id}/payments`, { amount: 1_200_000, note: 'Trả trước' });
  expect(res.statusCode).toBe(200);
  expect((await t.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(-200_000);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { counterpartyId: s.id, counterpartyType: 'supplier' } });
  expect(v).toMatchObject({ kind: 'out', amount: 1_200_000 });
  expect(v.code).toMatch(/^TTNCC\d{6}$/);
  const ledger = (await req('GET', `/api/suppliers/${s.id}/ledger`)).json();
  expect(ledger.items[0]).toMatchObject({ amount: -1_200_000, balanceAfter: -200_000 });
  expect((await req('GET', `/api/suppliers/${s.id}/recompute`)).json()).toEqual({ cached: -200_000, computed: -200_000 });
});

test('adjust-debt writes a ledger row and audit', async () => {
  const s = (await req('POST', '/api/suppliers', { name: 'Điều chỉnh' })).json();
  await req('POST', `/api/suppliers/${s.id}/adjust-debt`, { newDebt: 700_000, note: 'Số dư đầu kỳ' });
  expect((await t.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(700_000);
  expect(await t.prisma.partnerLedger.count({ where: { partnerId: s.id, docType: 'debtAdjust' } })).toBe(1);
});

test('deleting a supplier with documents deactivates it', async () => {
  const s = (await req('POST', '/api/suppliers', { name: 'Có giao dịch' })).json();
  await postPartnerLedger(t.prisma, { partnerType: 'supplier', partnerId: s.id, amount: 1, docType: 'receipt', docId: 3, docCode: 'PN3' });
  expect((await req('DELETE', `/api/suppliers/${s.id}`)).json()).toEqual({ deactivated: true });
  const fresh = (await req('POST', '/api/suppliers', { name: 'Xóa được' })).json();
  expect((await req('DELETE', `/api/suppliers/${fresh.id}`)).json()).toEqual({ deleted: true });
});

test('import reports row errors and writes nothing', async () => {
  const before = await t.prisma.supplier.count();
  const buf = await buildXlsx(SUPPLIER_IMPORT_COLUMNS, [{ code: 'NX1', name: 'Ok' }, { code: 'NX2', name: '' }]);
  const mp = multipart('file', 's.xlsx', buf);
  const res = await t.app.inject({ method: 'POST', url: '/api/suppliers/import', headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
  expect(res.json().errors).toEqual([expect.objectContaining({ row: 3 })]);
  expect(await t.prisma.supplier.count()).toBe(before);
});

test('supplier groups CRUD', async () => {
  const g = (await req('POST', '/api/supplier-groups', { name: 'May mặc' })).json();
  const s = (await req('POST', '/api/suppliers', { name: 'Trong nhóm', groupId: g.id })).json();
  const list = (await req('GET', `/api/suppliers?groupIds=${g.id}`)).json();
  expect(list.items.map((x: { id: number }) => x.id)).toEqual([s.id]);
  expect(list.items[0].groupName).toBe('May mặc');
});
