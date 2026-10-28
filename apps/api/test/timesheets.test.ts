import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(((m + 1440) % 1440) / 60))}:${pad(((m + 1440) % 1440) % 60)}`;

test('punch: no scheduled shift → 409; with one around now, in then out, then done', async () => {
  const userId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'admin' } })).id;
  const e = (await req('POST', '/api/employees', { name: 'Quản trị', branchId, userId })).json();
  expect((await req('POST', '/api/timesheets/punch', {})).json().error.code).toBe('NO_SHIFT');
  const vnNow = new Date(Date.now() + 7 * 3600_000);
  const minutes = vnNow.getUTCHours() * 60 + vnNow.getUTCMinutes();
  const startMin = minutes - 60;
  const date = new Date(vnNow.getTime() - (startMin < 0 ? 86400_000 : 0)).toISOString().slice(0, 10);
  const shift = (await req('POST', '/api/work-shifts', { name: 'Ca quanh giờ', start: hhmm(startMin), end: hhmm(minutes + 120) })).json();
  await req('POST', '/api/schedule', { employeeId: e.id, shiftId: shift.id, date });
  const a = (await req('POST', '/api/timesheets/punch', {})).json();
  expect(a.checkIn).toBeTruthy();
  expect(a.status).toBe('present');
  expect(a.late).toBeGreaterThanOrEqual(54);
  const b = (await req('POST', '/api/timesheets/punch', {})).json();
  expect(b.checkOut).toBeTruthy();
  expect(b.early).toBeGreaterThan(100);
  expect((await req('POST', '/api/timesheets/punch', {})).json().error.code).toBe('ALREADY_DONE');
});

test('manual edit recomputes minutes and marks manual; "present" without punches counts the full shift; summary counts statuses', async () => {
  const e = (await req('POST', '/api/employees', { name: 'Phạm Thu Hà', branchId })).json();
  const s = (await req('POST', '/api/work-shifts', { name: 'Ca chiều', start: '14:00', end: '22:00', breakMinutes: 30 })).json();
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) await req('POST', '/api/schedule', { employeeId: e.id, shiftId: s.id, date: d });
  const r = (await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: s.id, date: '2026-10-26', checkIn: '2026-10-26T07:20:00.000Z', checkOut: '2026-10-26T16:00:00.000Z', status: 'present', note: 'Quên chấm' })).json();
  // 14:20 → 23:00 local: late 15 (grace 5), overtime 30 (after 30), worked 460 − 30 + 30.
  expect([r.late, r.overtime, r.worked, r.manual]).toEqual([15, 30, 460, true]);
  expect((await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: s.id, date: '2026-10-27', status: 'present' })).json().worked).toBe(450);
  await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: s.id, date: '2026-10-28', status: 'paidLeave' });
  const grid = (await req('GET', `/api/timesheets?from=2026-10-26&to=2026-11-01&employeeIds=${e.id}`)).json();
  expect(grid.items.map((x: { status: string }) => x.status)).toEqual(['present', 'present', 'paidLeave']);
  const sum = (await req('GET', '/api/timesheets/summary?from=2026-10-26&to=2026-11-01')).json().find((x: { employeeId: number }) => x.employeeId === e.id);
  expect(sum).toMatchObject({ presentShifts: 2, paidLeaveShifts: 1, lateCount: 1, lateMinutes: 15, overtimeMinutes: 30, workedMinutes: 910 });
  expect((await req('PUT', '/api/timesheets', { employeeId: e.id, shiftId: s.id, date: '2026-10-30', status: 'present' })).json().error.code).toBe('NOT_SCHEDULED');
});
