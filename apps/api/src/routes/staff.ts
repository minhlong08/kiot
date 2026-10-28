import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { employeeInputSchema, normalizeVi, shiftInputSchema } from '@pd/shared';
import type { Prisma } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { nextCode } from '../services/codes';
import { idOf } from './purchasing';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dayOrNull = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const searchOf = (e: { code: string; name: string; phone: string; position: string }) => normalizeVi(`${e.code} ${e.name} ${e.phone} ${e.position}`);

export async function staffRoutes(app: FastifyInstance) {
  const db = app.prisma;

  // ── employees
  async function decorate(rows: Awaited<ReturnType<typeof db.employee.findMany>>) {
    const [users, branches, templates, tables] = await Promise.all([
      db.user.findMany({ where: { id: { in: rows.map(r => r.userId).filter((x): x is number => !!x) } }, select: { id: true, username: true } }),
      db.branch.findMany({ select: { id: true, name: true } }), db.salaryTemplate.findMany({ select: { id: true, name: true } }), db.commissionTable.findMany({ select: { id: true, name: true } }),
    ]);
    return rows.map(r => ({
      ...r, birthday: r.birthday?.toISOString().slice(0, 10) ?? null, startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
      userName: users.find(u => u.id === r.userId)?.username ?? null, branchName: branches.find(b => b.id === r.branchId)?.name ?? '',
      salaryTemplateName: templates.find(x => x.id === r.salaryTemplateId)?.name ?? null, commissionTableName: tables.find(x => x.id === r.commissionTableId)?.name ?? null,
    }));
  }
  function where(raw: Record<string, unknown>, branchId: number, isAdmin = false): Prisma.EmployeeWhereInput {
    const q = parseList(raw);
    const status = (raw.status as string) ?? 'active';
    return {
      branchId: raw.branchId === 'all' && isAdmin ? undefined : branchId, ...(status === 'all' ? {} : { isActive: status === 'active' }),
      ...(q.searchNorm ? { searchText: { contains: q.searchNorm } } : {}), ...(listParam(raw.positions) ? { position: { in: listParam(raw.positions) } } : {}),
    };
  }
  app.get('/api/employees', { preHandler: requirePermission('employees.view', 'payroll.view') }, async req => {
    const q = parseList(req.query);
    const u = user(req);
    const w = where(req.query as Record<string, unknown>, u.branchId, u.isAdmin);
    const [rows, total] = await Promise.all([db.employee.findMany({ where: w, orderBy: { code: 'asc' }, skip: q.skip, take: q.take }), db.employee.count({ where: w })]);
    const items = await decorate(rows);
    // Personal identity data is for HR (employees.view) only, not for payroll clerks.
    return { items: hasPerm(u, 'employees.view') ? items : items.map(e => ({ ...e, idNumber: '', birthday: null, address: '' })), total };
  });
  app.get('/api/employees/export', { preHandler: requirePermission('employees.export') }, async (req, reply) => {
    const rows = await decorate(await db.employee.findMany({ where: where(req.query as Record<string, unknown>, user(req).branchId, user(req).isAdmin), orderBy: { code: 'asc' } }));
    return sendXlsx(reply, 'nhan-vien.xlsx', [
      { header: 'Mã nhân viên', key: 'code' }, { header: 'Tên nhân viên', key: 'name' }, { header: 'Điện thoại', key: 'phone' }, { header: 'Chức danh', key: 'position' },
      { header: 'Chi nhánh', key: 'branchName' }, { header: 'Tài khoản', key: 'userName' }, { header: 'Mẫu lương', key: 'salaryTemplateName' },
    ], rows);
  });
  app.get('/api/employees/me', async req => {
    const e = await db.employee.findUnique({ where: { userId: user(req).id } });
    return e ? (await decorate([e]))[0] : null;
  });
  async function saveEmployee(data: z.infer<typeof employeeInputSchema>, auditCtx: Parameters<typeof audit>[1], branchId: number, id?: number) {
    if (id && !(await db.employee.findFirst({ where: { id, branchId } }))) throw notFound('Nhân viên');
    if (data.userId) {
      const linked = await db.employee.findUnique({ where: { userId: data.userId } });
      if (linked && linked.id !== id) throw conflict('USER_LINKED', `Tài khoản đã gắn với nhân viên ${linked.code} - ${linked.name}`);
    }
    return db.$transaction(async tx => {
      const before = id ? await tx.employee.findUnique({ where: { id } }) : null;
      if (id && !before) throw notFound('Nhân viên');
      const code = before?.code ?? await nextCode(tx, 'NV');
      const payload = { ...data, birthday: dayOrNull(data.birthday), startDate: dayOrNull(data.startDate), searchText: searchOf({ ...data, code }) };
      const e = before ? await tx.employee.update({ where: { id: before.id }, data: payload }) : await tx.employee.create({ data: { ...payload, code } });
      await audit(tx, auditCtx, { action: before ? 'update' : 'create', entity: 'Employee', entityId: e.id, entityCode: e.code, summary: `${before ? 'Cập nhật' : 'Thêm'} nhân viên ${e.code} - ${e.name}` });
      return (await decorate([e]))[0];
    });
  }
  app.post('/api/employees', { preHandler: requirePermission('employees.create') }, async req => saveEmployee(employeeInputSchema.parse(req.body), req.auditCtx, user(req).branchId));
  app.put('/api/employees/:id', { preHandler: requirePermission('employees.edit') }, async req => saveEmployee(employeeInputSchema.parse(req.body), req.auditCtx, user(req).branchId, idOf(req)));
  app.delete('/api/employees/:id', { preHandler: requirePermission('employees.delete') }, async req =>
    db.$transaction(async tx => {
      const e = await tx.employee.findFirst({ where: { id: idOf(req), branchId: user(req).branchId } });
      if (!e) throw notFound('Nhân viên');
      const used = (await tx.scheduleEntry.count({ where: { employeeId: e.id } })) + (await tx.timesheet.count({ where: { employeeId: e.id } })) + (await tx.paysheet.count({ where: { employeeId: e.id } }));
      if (used) {
        await tx.employee.update({ where: { id: e.id }, data: { isActive: false } });
        await audit(tx, req.auditCtx, { action: 'update', entity: 'Employee', entityId: e.id, entityCode: e.code, summary: `Ngừng làm việc ${e.code} - ${e.name}` });
        return { deactivated: true };
      }
      await tx.employee.delete({ where: { id: e.id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Employee', entityId: e.id, entityCode: e.code, summary: `Xóa nhân viên ${e.code} - ${e.name}` });
      return { deleted: true };
    }));

  // ── shift definitions (per branch)
  app.get('/api/work-shifts', async req => db.workShift.findMany({ where: { branchId: user(req).branchId }, orderBy: { start: 'asc' } }));
  app.post('/api/work-shifts', { preHandler: requirePermission('employees.edit', 'employees.create') }, async req => {
    const data = shiftInputSchema.parse(req.body);
    const s = await db.workShift.create({ data: { ...data, branchId: user(req).branchId } });
    await audit(db, req.auditCtx, { action: 'create', entity: 'WorkShift', entityId: s.id, entityCode: s.name, summary: `Tạo ca ${s.name} ${s.start}-${s.end}` });
    return s;
  });
  app.put('/api/work-shifts/:id', { preHandler: requirePermission('employees.edit') }, async req => {
    const data = shiftInputSchema.parse(req.body);
    const before = await db.workShift.findFirst({ where: { id: idOf(req), branchId: user(req).branchId } });
    if (!before) throw notFound('Ca làm việc');
    return db.workShift.update({ where: { id: before.id }, data });
  });
  app.delete('/api/work-shifts/:id', { preHandler: requirePermission('employees.edit') }, async req => {
    const s = await db.workShift.findFirst({ where: { id: idOf(req), branchId: user(req).branchId } });
    if (!s) throw notFound('Ca làm việc');
    if ((await db.scheduleEntry.count({ where: { shiftId: s.id } })) + (await db.timesheet.count({ where: { shiftId: s.id } }))) { await db.workShift.update({ where: { id: s.id }, data: { isActive: false } }); return { deactivated: true }; }
    await db.workShift.delete({ where: { id: s.id } });
    return { deleted: true };
  });

  // ── weekly schedule
  async function ownedEmployee(id: number, branchId: number) {
    const e = await db.employee.findFirst({ where: { id, branchId, isActive: true } });
    if (!e) throw notFound('Nhân viên');
    return e;
  }
  async function ownedShift(id: number, branchId: number) {
    const s = await db.workShift.findFirst({ where: { id, branchId } });
    if (!s) throw notFound('Ca làm việc');
    return s;
  }
  const dup = (e: unknown) => (e as { code?: string }).code === 'P2002' ? conflict('DUPLICATE_SHIFT', 'Nhân viên đã có ca này trong ngày') : e;
  app.get('/api/schedule', { preHandler: requirePermission('employees.view') }, async req => {
    const { from, to } = z.object({ from: DATE, to: DATE }).parse(req.query);
    const branchId = user(req).branchId;
    const [employees, shifts] = await Promise.all([
      db.employee.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, position: true } }),
      db.workShift.findMany({ where: { branchId }, orderBy: { start: 'asc' } }),
    ]);
    const entries = await db.scheduleEntry.findMany({ where: { date: { gte: from, lte: to }, employeeId: { in: employees.map(e => e.id) } } });
    return { employees, shifts, entries };
  });
  app.post('/api/schedule', { preHandler: requirePermission('employees.edit', 'employees.create') }, async req => {
    const b = z.object({ employeeId: z.number().int(), shiftId: z.number().int(), date: DATE }).parse(req.body);
    const branchId = user(req).branchId;
    await ownedEmployee(b.employeeId, branchId); await ownedShift(b.shiftId, branchId);
    return db.scheduleEntry.create({ data: b }).catch(e => { throw dup(e); });
  });
  app.post('/api/schedule/move', { preHandler: requirePermission('employees.edit') }, async req => {
    const b = z.object({ id: z.number().int(), employeeId: z.number().int(), date: DATE }).parse(req.body);
    const branchId = user(req).branchId;
    const entry = await db.scheduleEntry.findUnique({ where: { id: b.id } });
    if (!entry) throw notFound('Lịch làm việc');
    await ownedEmployee(entry.employeeId, branchId); await ownedEmployee(b.employeeId, branchId);
    return db.scheduleEntry.update({ where: { id: entry.id }, data: { employeeId: b.employeeId, date: b.date } }).catch(e => { throw dup(e); });
  });
  app.delete('/api/schedule/:id', { preHandler: requirePermission('employees.edit') }, async req => {
    const entry = await db.scheduleEntry.findUnique({ where: { id: idOf(req) } });
    if (!entry) throw notFound('Lịch làm việc');
    await ownedEmployee(entry.employeeId, user(req).branchId);
    await db.scheduleEntry.delete({ where: { id: entry.id } });
    return { ok: true };
  });
  app.post('/api/schedule/copy-week', { preHandler: requirePermission('employees.edit') }, async req => {
    const b = z.object({ fromMonday: DATE, toMonday: DATE }).parse(req.body);
    const branchId = user(req).branchId;
    const ids = (await db.employee.findMany({ where: { branchId, isActive: true }, select: { id: true } })).map(e => e.id);
    const src = await db.scheduleEntry.findMany({ where: { employeeId: { in: ids }, date: { gte: b.fromMonday, lte: addDays(b.fromMonday, 6) } } });
    const offset = Math.round((Date.parse(b.toMonday) - Date.parse(b.fromMonday)) / 86400_000);
    let copied = 0;
    await db.$transaction(async tx => {
      for (const e of src) {
        const date = addDays(e.date, offset);
        if (await tx.scheduleEntry.findUnique({ where: { employeeId_shiftId_date: { employeeId: e.employeeId, shiftId: e.shiftId, date } } })) continue;
        await tx.scheduleEntry.create({ data: { employeeId: e.employeeId, shiftId: e.shiftId, date } });
        copied++;
      }
    });
    return { copied };
  });
}
