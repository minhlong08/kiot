import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: cookie ? { cookie } : {}, payload: payload as object });

async function makeUser(username: string, perms: string[], branchCodes = ['CN01']) {
  const role = await t.prisma.role.create({ data: { name: `r-${username}`, permissions: { create: perms.map(key => ({ key })) } } });
  const branches = await t.prisma.branch.findMany({ where: { code: { in: branchCodes } } });
  await t.prisma.user.create({
    data: { username, fullName: username, passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, defaultBranchId: branches[0].id, branchAccess: { create: branches.map(b => ({ branchId: b.id })) } },
  });
  return t.login(username, 'pass123');
}

test('percent-encoded API paths still require a session', async () => {
  expect((await req('GET', '/%61pi/settings')).statusCode).toBe(401);
  expect((await req('GET', '/%61pi/branches')).statusCode).toBe(401);
});

test('percent-encoded API paths still enforce the password change gate', async () => {
  const cookie = await makeUser('fresh', ['settings.view']);
  await t.prisma.user.update({ where: { username: 'fresh' }, data: { mustChangePassword: true } });
  const res = await req('GET', '/%61pi/users', cookie);
  expect(res.statusCode).toBe(403);
  expect(res.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
});

test('a non-admin with settings.edit cannot grant themselves the admin role', async () => {
  const cookie = await makeUser('mgr', ['settings.view', 'settings.edit']);
  const me = await t.prisma.user.findUniqueOrThrow({ where: { username: 'mgr' } });
  const adminRole = await t.prisma.role.findFirstOrThrow({ where: { isAdmin: true } });
  const res = await req('PUT', `/api/users/${me.id}`, cookie, { roleId: adminRole.id });
  expect(res.statusCode).toBe(403);
});

test('a non-admin cannot reset or edit an admin user', async () => {
  const cookie = await makeUser('mgr2', ['settings.view', 'settings.edit']);
  const adminUser = await t.prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  expect((await req('POST', `/api/users/${adminUser.id}/reset-password`, cookie, { newPassword: 'hacked1' })).statusCode).toBe(403);
  expect((await req('PUT', `/api/users/${adminUser.id}`, cookie, { fullName: 'x' })).statusCode).toBe(403);
});

test('a non-admin cannot grant permissions they do not hold', async () => {
  const cookie = await makeUser('mgr3', ['settings.view', 'settings.edit']);
  const res = await req('POST', '/api/roles', cookie, { name: 'Sneaky', permissions: ['cashbook.delete'] });
  expect(res.statusCode).toBe(403);
});

test('the last active admin cannot be deactivated or demoted, even after renaming', async () => {
  const adminUser = await t.prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await t.prisma.user.update({ where: { id: adminUser.id }, data: { username: 'boss' } });
  const cashierRole = await t.prisma.role.findFirstOrThrow({ where: { name: 'Nhân viên bán hàng' } });
  const off = await req('PUT', `/api/users/${adminUser.id}`, admin, { isActive: false });
  expect(off.statusCode).toBe(409);
  expect(off.json().error.code).toBe('LAST_ADMIN');
  const demote = await req('PUT', `/api/users/${adminUser.id}`, admin, { roleId: cashierRole.id });
  expect(demote.statusCode).toBe(409);
  await t.prisma.user.update({ where: { id: adminUser.id }, data: { username: 'admin' } });
});

test('removing branch access moves the live session off that branch', async () => {
  await t.prisma.branch.create({ data: { code: 'CN05', name: 'Chi nhánh 5' } });
  const cookie = await makeUser('roam', ['products.view'], ['CN01', 'CN05']);
  const cn05 = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN05' } });
  const cn01 = await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } });
  await req('POST', '/api/auth/switch-branch', cookie, { branchId: cn05.id });
  const u = await t.prisma.user.findUniqueOrThrow({ where: { username: 'roam' } });
  await req('PUT', `/api/users/${u.id}`, admin, { branchIds: [cn01.id] });
  const me = await req('GET', '/api/auth/me', cookie);
  expect(me.statusCode).toBe(200);
  expect(me.json().user.branchId).toBe(cn01.id);
});

test('a session on a deactivated branch with no other access is signed out', async () => {
  const b = await t.prisma.branch.create({ data: { code: 'CN06', name: 'Chi nhánh 6' } });
  const cookie = await makeUser('solo', ['products.view'], ['CN06']);
  await req('DELETE', `/api/branches/${b.id}`, admin);
  expect((await req('GET', '/api/auth/me', cookie)).statusCode).toBe(401);
});

test('audit log search ignores diacritics', async () => {
  const res = await req('GET', '/api/audit-logs?search=dang%20nhap', admin);
  expect(res.json().total).toBeGreaterThan(0);
});
