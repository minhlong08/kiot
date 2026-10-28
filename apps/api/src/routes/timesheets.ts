import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { shiftWindow } from '@pd/shared';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { listParam } from '../lib/list';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { rowMinutes, timesheetSummary } from '../services/timesheets';
import { addDays } from './staff';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STATUSES = ['scheduled', 'present', 'absent', 'paidLeave', 'unpaidLeave'] as const;

export async function timesheetRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/timesheets', async req => {
    const q = z.object({ from: DATE, to: DATE }).parse(req.query);
    const u = user(req);
    const branchEmployees = await db.employee.findMany({ where: { branchId: u.branchId }, select: { id: true } });
    let ids = listParam((req.query as Record<string, unknown>).employeeIds)?.map(Number) ?? branchEmployees.map(e => e.id);
    // Without employees.view a user only sees their own timesheet.
    if (!hasPerm(u, 'employees.view')) ids = (await db.employee.findMany({ where: { userId: u.id }, select: { id: true } })).map(e => e.id);
    ids = ids.filter(id => branchEmployees.some(e => e.id === id));
    const [entries, rows] = await Promise.all([
      db.scheduleEntry.findMany({ where: { employeeId: { in: ids }, date: { gte: q.from, lte: q.to } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
      db.timesheet.findMany({ where: { employeeId: { in: ids }, date: { gte: q.from, lte: q.to } } }),
    ]);
    const key = (x: { employeeId: number; shiftId: number; date: string }) => `${x.employeeId}:${x.shiftId}:${x.date}`;
    const byKey = new Map(rows.map(r => [key(r), r]));
    const items = entries.map(e => byKey.get(key(e)) ?? { id: null, employeeId: e.employeeId, shiftId: e.shiftId, date: e.date, checkIn: null, checkOut: null, status: 'scheduled', late: 0, early: 0, overtime: 0, worked: 0, manual: false, note: '' });
    // Rows whose schedule entry was later removed still show (they carry worked time).
    for (const r of rows) if (!entries.some(e => key(e) === key(r))) items.push(r);
    return { items };
  });

  app.get('/api/timesheets/summary', { preHandler: requirePermission('employees.view', 'payroll.view') }, async req => {
    const q = z.object({ from: DATE, to: DATE }).parse(req.query);
    const ids = (await db.employee.findMany({ where: { branchId: user(req).branchId }, select: { id: true } })).map(e => e.id);
    return timesheetSummary(db, ids, q.from, q.to);
  });

  app.put('/api/timesheets', { preHandler: requirePermission('employees.edit') }, async req => {
    const b = z.object({
      employeeId: z.number().int(), shiftId: z.number().int(), date: DATE, status: z.enum(STATUSES),
      checkIn: z.string().datetime().nullable().default(null), checkOut: z.string().datetime().nullable().default(null), note: z.string().max(300).default(''),
    }).parse(req.body);
    const u = user(req);
    const [emp, shift] = await Promise.all([db.employee.findFirst({ where: { id: b.employeeId, branchId: u.branchId } }), db.workShift.findFirst({ where: { id: b.shiftId, branchId: u.branchId } })]);
    if (!emp || !shift) throw notFound('Nhân viên hoặc ca');
    const sched = await db.scheduleEntry.findUnique({ where: { employeeId_shiftId_date: { employeeId: b.employeeId, shiftId: b.shiftId, date: b.date } } });
    const existing = await db.timesheet.findUnique({ where: { employeeId_shiftId_date: { employeeId: b.employeeId, shiftId: b.shiftId, date: b.date } } });
    if (!sched && !existing) throw conflict('NOT_SCHEDULED', 'Nhân viên không có ca này trong ngày');
    const checkIn = b.checkIn ? new Date(b.checkIn) : null, checkOut = b.checkOut ? new Date(b.checkOut) : null;
    const m = rowMinutes(shift, b.date, b.status, checkIn, checkOut, (await getSettings(db)).staff);
    const data = { checkIn, checkOut, status: b.status, note: b.note, manual: true, updatedAt: new Date(), ...m };
    return db.$transaction(async tx => {
      const r = await tx.timesheet.upsert({ where: { employeeId_shiftId_date: { employeeId: b.employeeId, shiftId: b.shiftId, date: b.date } }, create: { employeeId: b.employeeId, shiftId: b.shiftId, date: b.date, ...data }, update: data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Timesheet', entityId: r.id, entityCode: emp.code, summary: `Chấm công ${emp.name} ngày ${b.date} (${shift.name}): ${b.status}`, before: existing ?? undefined, after: r });
      return r;
    });
  });

  /** The signed-in user's own punch: in, then out, on the scheduled shift around now. */
  app.post('/api/timesheets/punch', async req => {
    const u = user(req);
    const emp = await db.employee.findFirst({ where: { userId: u.id, isActive: true } });
    if (!emp) throw conflict('NO_EMPLOYEE', 'Tài khoản chưa gắn với nhân viên');
    const now = new Date();
    const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const entries = await db.scheduleEntry.findMany({ where: { employeeId: emp.id, date: { in: [addDays(today, -1), today] } } });
    const shifts = await db.workShift.findMany({ where: { id: { in: entries.map(e => e.shiftId) } } });
    const rows = await db.timesheet.findMany({ where: { employeeId: emp.id, date: { in: [addDays(today, -1), today] } } });
    // Candidates: shifts whose window (2h before start .. 4h after end) holds now; an open (checked-in) one first, else the nearest start.
    const candidates = entries.map(e => {
      const s = shifts.find(x => x.id === e.shiftId)!;
      const w = shiftWindow(e.date, s);
      const row = rows.find(r => r.shiftId === e.shiftId && r.date === e.date);
      return { e, s, w, row };
    }).filter(c => now.getTime() >= c.w.start.getTime() - 2 * 3600_000 && now.getTime() <= c.w.end.getTime() + 4 * 3600_000);
    if (!candidates.length) throw conflict('NO_SHIFT', 'Không có ca làm việc nào vào lúc này');
    const pick = candidates.find(c => c.row?.checkIn && !c.row.checkOut)
      ?? candidates.filter(c => !c.row?.checkOut).sort((a, b) => Math.abs(a.w.start.getTime() - now.getTime()) - Math.abs(b.w.start.getTime() - now.getTime()))[0];
    if (!pick) throw conflict('ALREADY_DONE', 'Đã chấm công vào và ra cho ca này');
    const checkIn = pick.row?.checkIn ?? now;
    const checkOut = pick.row?.checkIn ? now : null;
    const rules = (await getSettings(db)).staff;
    const m = checkOut ? rowMinutes(pick.s, pick.e.date, 'present', checkIn, checkOut, rules) : { ...rowMinutes(pick.s, pick.e.date, 'present', checkIn, pick.w.end, rules), early: 0, overtime: 0 };
    const data = { checkIn, checkOut, status: 'present', updatedAt: now, ...m };
    const key = { employeeId_shiftId_date: { employeeId: emp.id, shiftId: pick.s.id, date: pick.e.date } };
    const r = await db.timesheet.upsert({ where: key, create: { employeeId: emp.id, shiftId: pick.s.id, date: pick.e.date, ...data }, update: data });
    await audit(db, req.auditCtx, { action: 'update', entity: 'Timesheet', entityId: r.id, entityCode: emp.code, summary: `${emp.name} chấm công ${checkOut ? 'ra' : 'vào'} (${pick.s.name})` });
    return r;
  });
}
