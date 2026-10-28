import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, multipart } from './helpers';
import { makeCustomer } from './factories';
import { buildXlsx } from '../src/lib/excel';
import { CUSTOMER_IMPORT_COLUMNS } from '../src/services/customers';
import { postPartnerLedger } from '../src/services/partnerLedger';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('auto code, audit, and accent-insensitive search', async () => {
  const c = (await req('POST', '/api/customers', { name: 'Nguyễn Thị Lan', phone: '0901000001', birthday: '1992-05-12', province: 'TP. Hồ Chí Minh' })).json();
  expect(c.code).toMatch(/^KH\d{6}$/);
  expect(await t.prisma.auditLog.count({ where: { entity: 'Customer', action: 'create' } })).toBe(1);
  expect((await req('GET', '/api/customers?search=nguyen%20thi%20lan')).json().items.map((x: { id: number }) => x.id)).toContain(c.id);
});

test('a duplicate phone asks for confirmation; force saves', async () => {
  const dup = await req('POST', '/api/customers', { name: 'Lan 2', phone: '0901000001' });
  expect(dup.statusCode).toBe(409);
  expect(dup.json().error.code).toBe('DUPLICATE_PHONE');
  expect((await req('POST', '/api/customers', { name: 'Lan 2', phone: '0901000001', force: true })).statusCode).toBe(200);
});

test('birthday month filter', async () => {
  const may = (await req('GET', '/api/customers?birthdayMonth=5')).json();
  expect(may.items.every((x: { birthday: string }) => new Date(x.birthday).getUTCMonth() === 4)).toBe(true);
  expect(may.total).toBeGreaterThan(0);
});

test('a debt payment reduces debt and writes a TTKH cash-in voucher', async () => {
  const c = await makeCustomer(t.prisma);
  await postPartnerLedger(t.prisma, { partnerType: 'customer', partnerId: c.id, amount: 500_000, docType: 'invoice', docId: 1, docCode: 'HD1' });
  expect((await req('POST', `/api/customers/${c.id}/payments`, { amount: 500_000 })).statusCode).toBe(200);
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(0);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { counterpartyType: 'customer', counterpartyId: c.id } });
  expect(v).toMatchObject({ kind: 'in', amount: 500_000 });
  expect(v.code).toMatch(/^TTKH\d{6}$/);
});

test('adjust-points writes a loyalty row', async () => {
  const c = await makeCustomer(t.prisma);
  await req('POST', `/api/customers/${c.id}/adjust-points`, { newPoints: 250, note: 'Chuyển từ hệ thống cũ' });
  const pts = (await req('GET', `/api/customers/${c.id}/points`)).json();
  expect(pts.items[0]).toMatchObject({ points: 250, balanceAfter: 250 });
});

test('lookup by phone for the till', async () => {
  const c = await makeCustomer(t.prisma, { name: 'Trần Văn Bình', phone: '0988777666' });
  expect((await req('GET', '/api/customers/lookup?q=0988777666')).json()[0]).toMatchObject({ id: c.id, name: 'Trần Văn Bình' });
});

test('deleting a customer with history deactivates; without history removes', async () => {
  const c = await makeCustomer(t.prisma);
  await postPartnerLedger(t.prisma, { partnerType: 'customer', partnerId: c.id, amount: 1, docType: 'invoice', docId: 2, docCode: 'HD2' });
  expect((await req('DELETE', `/api/customers/${c.id}`)).json()).toEqual({ deactivated: true });
  const fresh = await makeCustomer(t.prisma);
  expect((await req('DELETE', `/api/customers/${fresh.id}`)).json()).toEqual({ deleted: true });
});

test('debt range filter and totals', async () => {
  const list = (await req('GET', '/api/customers?debtFrom=1')).json();
  expect(list.items.every((x: { debt: number }) => x.debt >= 1)).toBe(true);
  expect(list.totals.debt).toBe(list.items.reduce((s: number, x: { debt: number }) => s + x.debt, 0));
});

test('import reports row errors and writes nothing', async () => {
  const before = await t.prisma.customer.count();
  const buf = await buildXlsx(CUSTOMER_IMPORT_COLUMNS, [{ code: 'KHX1', name: 'Ok', birthday: '12/05/1990' }, { code: 'KHX2', name: 'Bad', birthday: '31/02/1990' }]);
  const mp = multipart('file', 'c.xlsx', buf);
  const res = await t.app.inject({ method: 'POST', url: '/api/customers/import', headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
  expect(res.json().errors).toEqual([expect.objectContaining({ row: 3 })]);
  expect(await t.prisma.customer.count()).toBe(before);
});
