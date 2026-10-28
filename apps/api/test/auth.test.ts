import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => { t = await createTestApp(); });
afterAll(() => t.close());

test('login with admin/admin123 sets an httpOnly pd_sid cookie', async () => {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'admin', password: 'admin123' } });
  expect(res.statusCode).toBe(200);
  const c = res.cookies.find(c => c.name === 'pd_sid')!;
  expect(c.httpOnly).toBe(true);
  expect(res.json().user.mustChangePassword).toBe(true);
});

test('wrong password returns 401 INVALID_CREDENTIALS', async () => {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'admin', password: 'nope' } });
  expect(res.statusCode).toBe(401);
  expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
});

test('login writes a login audit entry', async () => {
  await t.login();
  expect(await t.prisma.auditLog.count({ where: { action: 'login' } })).toBeGreaterThan(0);
});

test('me without cookie is 401', async () => {
  const res = await t.app.inject({ url: '/api/auth/me' });
  expect(res.statusCode).toBe(401);
});

test('me returns user, branches and permissions', async () => {
  const cookie = await t.login();
  const res = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.user.username).toBe('admin');
  expect(body.branches[0].name).toBe('Chi nhánh trung tâm');
  expect(body.user.isAdmin).toBe(true);
});

test('change-password rejects admin123 as new password', async () => {
  const cookie = await t.login();
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { cookie }, payload: { currentPassword: 'admin123', newPassword: 'admin123' } });
  expect(res.statusCode).toBe(400);
});

test('change-password rejects a wrong current password', async () => {
  const cookie = await t.login();
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { cookie }, payload: { currentPassword: 'bad', newPassword: 'Secret@1' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe('WRONG_PASSWORD');
});

test('login by phone works and inactive users are refused', async () => {
  const role = await t.prisma.role.findFirstOrThrow({ where: { isAdmin: false } });
  const b1 = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  await t.prisma.user.create({ data: { username: 'thu', phone: '0901234567', fullName: 'Thu', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId: b1.id }] } } });
  const ok = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: '0901234567', password: 'pass123' } });
  expect(ok.statusCode).toBe(200);
  await t.prisma.user.update({ where: { username: 'thu' }, data: { isActive: false } });
  const no = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'thu', password: 'pass123' } });
  expect(no.statusCode).toBe(401);
  expect(no.json().error.code).toBe('INACTIVE');
});

test('switch-branch refuses a branch outside the access list', async () => {
  const role = await t.prisma.role.findFirstOrThrow({ where: { isAdmin: false } });
  const b2 = await t.prisma.branch.create({ data: { code: 'CN02', name: 'Chi nhánh 2' } });
  const b1 = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  await t.prisma.user.create({
    data: { username: 'lan', fullName: 'Lan', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, defaultBranchId: b1.id, branchAccess: { create: [{ branchId: b1.id }] } },
  });
  const cookie = await t.login('lan', 'pass123');
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/switch-branch', headers: { cookie }, payload: { branchId: b2.id } });
  expect(res.statusCode).toBe(403);
});

test('logout ends the session', async () => {
  const cookie = await t.login();
  await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  const res = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
  expect(res.statusCode).toBe(401);
});
