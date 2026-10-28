import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { makeCustomer } from './factories';
import { redeemVoucher, releaseVoucher } from '../src/services/promotions';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

async function userWith(username: string, perms: string[]) {
  const b = await t.prisma.branch.findFirstOrThrow();
  const role = await t.prisma.role.create({ data: { name: `r-${username}`, permissions: { create: perms.map(key => ({ key })) } } });
  await t.prisma.user.create({ data: { username, fullName: username, passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId: b.id }] } } });
  return t.login(username, 'pass123');
}

test('I-3: customer lookup needs a customer or selling permission', async () => {
  const clerk = await userWith('clerk', ['products.view']);
  expect((await req('GET', '/api/customers/lookup?q=a', undefined, clerk)).statusCode).toBe(403);
});

test('I-4: export needs customers.export itself', async () => {
  const viewer = await userWith('viewer', ['customers.view']);
  expect((await req('GET', '/api/customers/export', undefined, viewer)).statusCode).toBe(403);
});

test('I-5: adjusting debt/points needs customers.adjust and a reason', async () => {
  const editor = await userWith('editor', ['customers.view', 'customers.edit']);
  const c = await makeCustomer(t.prisma);
  expect((await req('POST', `/api/customers/${c.id}/adjust-points`, { newPoints: 1000, note: 'x' }, editor)).statusCode).toBe(403);
  expect((await req('POST', `/api/customers/${c.id}/adjust-debt`, { newDebt: 1000, note: 'x' }, editor)).statusCode).toBe(403);
  expect((await req('POST', `/api/customers/${c.id}/adjust-points`, { newPoints: 1000, note: '' })).statusCode).toBe(400);
});

test('I-5: messaging needs customers.message; dry run returns the recipient count without sending', async () => {
  const editor = await userWith('editor2', ['customers.view', 'customers.edit']);
  expect((await req('POST', '/api/messages/send', { body: 'Hi', filter: {} }, editor)).statusCode).toBe(403);
  await makeCustomer(t.prisma, { phone: '0909' });
  const before = await t.prisma.messageLog.count();
  const dry = (await req('POST', '/api/messages/send', { body: 'Hi', filter: {}, dryRun: true })).json();
  expect(dry.recipients).toBeGreaterThan(0);
  expect(await t.prisma.messageLog.count()).toBe(before);
});

test('I-6: release normalises the code and never drives multi-use usage below zero', async () => {
  const c = (await req('POST', '/api/voucher-campaigns', { name: 'Nhiều lần', value: 10_000, unit: 'VND', multiUse: true })).json();
  const [code] = (await req('POST', `/api/voucher-campaigns/${c.id}/generate`, { count: 1 })).json().codes;
  await t.prisma.$transaction(tx => redeemVoucher(tx, code.toLowerCase(), 1, 100_000));
  await t.prisma.$transaction(tx => releaseVoucher(tx, ` ${code.toLowerCase()} `, 1));
  await t.prisma.$transaction(tx => releaseVoucher(tx, code, 1));
  expect((await t.prisma.voucher.findUniqueOrThrow({ where: { code } })).usageCount).toBe(0);
});

test('I-7: a customer group used by a promotion cannot be deleted', async () => {
  const g = (await req('POST', '/api/customer-groups', { name: 'Nhóm KM' })).json();
  await req('POST', '/api/promotions', { name: 'Chỉ nhóm', type: 'invoiceDiscount', config: { tiers: [{ minTotal: 0, value: 1, unit: '%' }] }, customerGroupIds: [g.id] });
  expect((await req('DELETE', `/api/customer-groups/${g.id}`)).json().error.code).toBe('IN_USE');
});

test('phones are normalised: spaced and plain numbers are duplicates and lookup finds both', async () => {
  const a = (await req('POST', '/api/customers', { name: 'SĐT có cách', phone: '0912 345 678' })).json();
  expect(a.phone).toBe('0912345678');
  expect((await req('POST', '/api/customers', { name: 'Trùng', phone: '0912.345.678' })).json().error.code).toBe('DUPLICATE_PHONE');
  expect((await req('GET', '/api/customers/lookup?q=0912 345 678')).json()[0].id).toBe(a.id);
});
