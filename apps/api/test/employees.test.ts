import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let shiftId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  branchId = await mainBranchId(t.prisma);
  shiftId = (await req('POST', '/api/work-shifts', { name: 'Ca sáng', start: '08:00', end: '14:00' })).json().id;
});
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const emp = (o: object = {}) => req('POST', '/api/employees', { name: 'Nguyễn Văn An', phone: '0901234567', branchId, ...o });

test('employee code NV + link to a user; a second employee on the same user → 409', async () => {
  const userId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).id;
  const e = (await emp({ userId })).json();
  expect(e.code).toMatch(/^NV\d{6}$/);
  expect((await emp({ name: 'Trùng', userId })).json().error.code).toBe('USER_LINKED');
  const list = (await req('GET', '/api/employees?search=van an')).json();
  expect(list.items.map((x: { id: number }) => x.id)).toContain(e.id);
  expect(list.items[0].userName).toBe('admin');
});

test('schedule: assign, duplicate → 409, move, delete; copy week copies once', async () => {
  const a = (await emp({ name: 'Lê Thị Bình' })).json();
  const b = (await emp({ name: 'Trần Văn Cường' })).json();
  const entry = (await req('POST', '/api/schedule', { employeeId: a.id, shiftId, date: '2026-10-26' })).json();
  expect((await req('POST', '/api/schedule', { employeeId: a.id, shiftId, date: '2026-10-26' })).json().error.code).toBe('DUPLICATE_SHIFT');
  expect((await req('POST', '/api/schedule/move', { id: entry.id, employeeId: b.id, date: '2026-10-27' })).json()).toMatchObject({ employeeId: b.id, date: '2026-10-27' });
  await req('POST', '/api/schedule', { employeeId: a.id, shiftId, date: '2026-10-28' });
  const r1 = (await req('POST', '/api/schedule/copy-week', { fromMonday: '2026-10-26', toMonday: '2026-11-02' })).json();
  const r2 = (await req('POST', '/api/schedule/copy-week', { fromMonday: '2026-10-26', toMonday: '2026-11-02' })).json();
  expect([r1.copied, r2.copied]).toEqual([2, 0]);
  const week = (await req('GET', '/api/schedule?from=2026-11-02&to=2026-11-08')).json();
  expect(week.entries.map((e: { date: string }) => e.date).sort()).toEqual(['2026-11-03', '2026-11-04']);
  expect(week.shifts.map((s: { id: number }) => s.id)).toContain(shiftId);
  expect((await req('DELETE', `/api/schedule/${entry.id}`)).statusCode).toBe(200);
  // An employee with schedule history is deactivated, not deleted.
  expect((await req('DELETE', `/api/employees/${a.id}`)).json()).toEqual({ deactivated: true });
});

test('payroll-only users get no ID/birthday/address; other branches are out of reach', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const e = (await req('POST', '/api/employees', { name: 'Có CCCD', branchId, idNumber: '001099000123', birthday: '1999-01-02', address: '1 Hàng Bông' })).json();
  const role = await t.prisma.role.create({ data: { name: 'Kế toán lương', permissions: { create: [{ key: 'payroll.view' }] } } });
  await t.prisma.user.create({ data: { username: 'ketoan', fullName: 'K', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId }] } } });
  const cookie = await t.login('ketoan', 'pass123');
  const row = (await t.app.inject({ method: 'GET', url: '/api/employees?status=all', headers: { cookie } })).json().items.find((x: { id: number }) => x.id === e.id);
  expect([row.idNumber, row.birthday, row.address]).toEqual(['', null, '']);
  const other = await t.prisma.branch.create({ data: { code: 'CN09', name: 'Chi nhánh khác', address: '' } });
  const far = await t.prisma.employee.create({ data: { code: 'NV999999', name: 'Ở chi nhánh khác', branchId: other.id } });
  expect((await req('PUT', `/api/employees/${far.id}`, { name: 'Sửa trộm', branchId })).statusCode).toBe(404);
  expect((await req('DELETE', `/api/employees/${far.id}`)).statusCode).toBe(404);
});

test('a shift with timesheet rows is deactivated, not deleted', async () => {
  const e = (await req('POST', '/api/employees', { name: 'Ca bị xóa', branchId })).json();
  const s = (await req('POST', '/api/work-shifts', { name: 'Ca tạm', start: '09:00', end: '12:00' })).json();
  const entry = (await req('POST', '/api/schedule', { employeeId: e.id, shiftId: s.id, date: '2026-10-20' })).json();
  await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: s.id, date: '2026-10-20', status: 'present' });
  await req('DELETE', `/api/schedule/${entry.id}`);
  expect((await req('DELETE', `/api/work-shifts/${s.id}`)).json()).toEqual({ deactivated: true });
});
