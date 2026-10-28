import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { makeCustomer, makeProduct } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown, cookie = admin) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

test('backup → change data → restore gives back the same rows; the caller stays signed in', async () => {
  const c = await makeCustomer(t.prisma, { name: 'Khách sao lưu' });
  await makeProduct(t.prisma, { name: 'Hàng sao lưu' });
  const backup = await req('GET', '/api/system/backup');
  expect(backup.statusCode).toBe(200);
  expect(backup.headers['content-disposition']).toContain('.json');
  const doc = backup.json();
  expect(doc.app).toBe('phuongdong-pos');
  const counts = { customer: await t.prisma.customer.count(), product: await t.prisma.product.count() };

  await t.prisma.customer.update({ where: { id: c.id }, data: { name: 'Đã sửa' } });
  await makeProduct(t.prisma, { name: 'Thêm sau sao lưu' });
  const r = await req('POST', '/api/system/restore', doc);
  expect(r.statusCode, r.body).toBe(200);
  expect(await t.prisma.customer.count()).toBe(counts.customer);
  expect(await t.prisma.product.count()).toBe(counts.product);
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe('Khách sao lưu');
  expect((await req('GET', '/api/auth/me')).statusCode).toBe(200);
  // New rows after a restore get fresh ids (sequences restored).
  const after = await makeProduct(t.prisma, { name: 'Sau khôi phục' });
  expect(after.id).toBeGreaterThan(Math.max(...doc.tables.Product.map((p: { id: number }) => p.id)));
});

test('a backup from another app/version or with a bad row changes nothing', async () => {
  const doc = (await req('GET', '/api/system/backup')).json();
  const before = await t.prisma.customer.count();
  expect((await req('POST', '/api/system/restore', { ...doc, version: 'khac' })).json().error.code).toBe('BACKUP_VERSION');
  expect((await req('POST', '/api/system/restore', { ...doc, app: 'khac' })).json().error.code).toBe('BACKUP_VERSION');
  const broken = { ...doc, tables: { ...doc.tables, Customer: [...doc.tables.Customer, { id: 999999, name: null }] } };
  expect((await req('POST', '/api/system/restore', broken)).statusCode).toBeGreaterThanOrEqual(400);
  expect(await t.prisma.customer.count()).toBe(before);
});

test('only admins; reset demo needs the typed confirmation and leaves a freshly seeded store', async () => {
  const b = await t.prisma.branch.findFirstOrThrow();
  const role = await t.prisma.role.create({ data: { name: 'Quản lý', permissions: { create: [{ key: 'settings.edit' }] } } });
  await t.prisma.user.create({ data: { username: 'quanly', fullName: 'Q', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId: b.id }] } } });
  const manager = await t.login('quanly', 'pass123');
  expect((await req('GET', '/api/system/backup', undefined, manager)).statusCode).toBe(403);
  expect((await req('POST', '/api/system/reset-demo', { confirm: 'xoa' })).json().error.code).toBe('CONFIRM');
  await makeCustomer(t.prisma, { name: 'Sẽ bị xóa' });
  expect((await req('POST', '/api/system/reset-demo', { confirm: 'XOA DU LIEU' })).statusCode).toBe(200);
  expect(await t.prisma.customer.count({ where: { name: 'Sẽ bị xóa' } })).toBe(0);
  expect(await t.prisma.user.count({ where: { username: 'quanly' } })).toBe(0);
  expect((await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).mustChangePassword).toBe(true);
  expect(await t.prisma.product.count()).toBeGreaterThan(30);
  expect((await req('GET', '/api/auth/me')).statusCode).toBe(401);
}, 60_000);
