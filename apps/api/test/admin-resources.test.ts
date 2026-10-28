import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, cookie: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

test('API calls are blocked until the default password is changed', async () => {
  const cookie = await t.login('admin', 'admin123');
  await t.prisma.user.update({ where: { username: 'admin' }, data: { mustChangePassword: true } });
  const res = await req('GET', '/api/branches', cookie);
  expect(res.statusCode).toBe(403);
  expect(res.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  await req('POST', '/api/auth/change-password', cookie, { currentPassword: 'admin123', newPassword: 'Admin@2026' });
  expect((await req('GET', '/api/branches', cookie)).statusCode).toBe(200);
  await t.prisma.user.update({ where: { username: 'admin' }, data: { passwordHash: bcrypt.hashSync('admin123', 4) } });
  admin = await t.loginAdmin(); // changing the password signed out the admin's other sessions
});

test('creating a branch writes an audit row', async () => {
  const res = await req('POST', '/api/branches', admin, { code: 'CN09', name: 'Chi nhánh Quận 9' });
  expect(res.statusCode).toBe(200);
  const id = res.json().id;
  const log = await t.prisma.auditLog.findFirst({ where: { entity: 'Branch', entityId: String(id), action: 'create' } });
  expect(log?.entityCode).toBe('CN09');
});

test('branch list is paginated with total', async () => {
  const res = await req('GET', '/api/branches?pageSize=15', admin);
  expect(res.json().total).toBeGreaterThanOrEqual(2);
});

test('role with permissions; delete refused while assigned', async () => {
  const res = await req('POST', '/api/roles', admin, { name: 'Kho', maxDiscountPercent: 0, permissions: ['products.view', 'stockTakes.create'] });
  expect(res.statusCode).toBe(200);
  const role = res.json();
  expect(role.permissions.sort()).toEqual(['products.view', 'stockTakes.create']);
  const unknown = await req('POST', '/api/roles', admin, { name: 'X', maxDiscountPercent: 0, permissions: ['nope.view'] });
  expect(unknown.statusCode).toBe(400);
  const b = await t.prisma.branch.findFirstOrThrow();
  await req('POST', '/api/users', admin, { username: 'kho1', fullName: 'Kho 1', password: 'pass123', roleId: role.id, branchIds: [b.id] });
  const del = await req('DELETE', `/api/roles/${role.id}`, admin);
  expect(del.statusCode).toBe(409);
  expect(del.json().error.code).toBe('ROLE_IN_USE');
});

test('cashier lacks settings permission', async () => {
  const role = await t.prisma.role.findFirstOrThrow({ where: { name: 'Nhân viên bán hàng' } });
  const b = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  await req('POST', '/api/users', admin, { username: 'cashier', fullName: 'Thu ngân', password: 'pass123', roleId: role.id, branchIds: [b.id] });
  await t.prisma.user.update({ where: { username: 'cashier' }, data: { mustChangePassword: false } });
  const cookie = await t.login('cashier', 'pass123');
  const res = await req('PUT', '/api/settings', cookie, { products: { allowNegativeStock: true } });
  expect(res.statusCode).toBe(403);
});

test('deactivating a user ends their sessions', async () => {
  const role = await t.prisma.role.findFirstOrThrow({ where: { name: 'Nhân viên bán hàng' } });
  const b = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  const created = await req('POST', '/api/users', admin, { username: 'tam', fullName: 'Tâm', password: 'pass123', roleId: role.id, branchIds: [b.id] });
  expect(created.json().mustChangePassword).toBe(true);
  const cookie = await t.login('tam', 'pass123');
  await req('PUT', `/api/users/${created.json().id}`, admin, { isActive: false });
  expect((await req('GET', '/api/auth/me', cookie)).statusCode).toBe(401);
});

test('user list never exposes password hashes', async () => {
  const res = await req('GET', '/api/users', admin);
  expect(res.body).not.toContain('passwordHash');
});
