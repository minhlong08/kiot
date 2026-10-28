import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { moneySchema } from '@pd/shared';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { AppError, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { nextCode } from '../services/codes';
import { assertDraft, generatePaysheets, payPaysheet } from '../services/payroll';
import { docCtx, idOf } from './purchasing';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STATUS: Record<string, string> = { draft: 'Tạm tính', locked: 'Đã chốt', cancelled: 'Đã hủy' };

export async function payrollRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const own = async (id: number, branchId: number) => {
    const p = await db.payrollPeriod.findUnique({ where: { id } });
    if (!p || p.branchId !== branchId) throw notFound('Bảng lương');
    return p;
  };
  async function withTotals(periods: Awaited<ReturnType<typeof db.payrollPeriod.findMany>>) {
    const sums = await db.paysheet.groupBy({ by: ['periodId'], where: { periodId: { in: periods.map(p => p.id) } }, _sum: { total: true, paid: true }, _count: { _all: true } });
    return periods.map(p => {
      const s = sums.find(x => x.periodId === p.id);
      const total = s?._sum.total ?? 0, paid = s?._sum.paid ?? 0;
      return { ...p, statusLabel: STATUS[p.status], total, paid, remaining: total - paid, employeeCount: s?._count._all ?? 0 };
    });
  }

  app.get('/api/payroll-periods', { preHandler: requirePermission('payroll.view') }, async req => {
    const q = parseList(req.query);
    const where = { branchId: user(req).branchId, status: { not: 'cancelled' } };
    const [rows, total] = await Promise.all([db.payrollPeriod.findMany({ where, orderBy: { from: 'desc' }, skip: q.skip, take: q.take }), db.payrollPeriod.count({ where })]);
    return { items: await withTotals(rows), total };
  });
  app.get('/api/payroll-periods/:id', { preHandler: requirePermission('payroll.view') }, async req => {
    const p = await own(idOf(req), user(req).branchId);
    const sheets = await db.paysheet.findMany({ where: { periodId: p.id }, orderBy: { id: 'asc' } });
    const emps = await db.employee.findMany({ where: { id: { in: sheets.map(s => s.employeeId) } }, select: { id: true, code: true, name: true, position: true } });
    return { ...(await withTotals([p]))[0], paysheets: sheets.map(s => ({ ...s, detail: JSON.parse(s.detail), employee: emps.find(e => e.id === s.employeeId) })) };
  });
  app.get('/api/payroll-periods/:id/export', { preHandler: requirePermission('payroll.export') }, async (req, reply) => {
    const p = await own(idOf(req), user(req).branchId);
    const sheets = await db.paysheet.findMany({ where: { periodId: p.id }, orderBy: { id: 'asc' } });
    const emps = await db.employee.findMany({ where: { id: { in: sheets.map(s => s.employeeId) } } });
    return sendXlsx(reply, `bang-luong-${p.code}.xlsx`, [
      { header: 'Mã phiếu', key: 'code' }, { header: 'Nhân viên', key: 'name' }, { header: 'Lương chính', key: 'base' }, { header: 'Làm thêm', key: 'overtime' },
      { header: 'Phụ cấp', key: 'allowance' }, { header: 'Giảm trừ', key: 'deduction' }, { header: 'Hoa hồng', key: 'commission' }, { header: 'Thưởng', key: 'bonus' },
      { header: 'Tổng lương', key: 'total' }, { header: 'Đã trả', key: 'paid' },
    ], sheets.map(s => ({ ...s, name: emps.find(e => e.id === s.employeeId)?.name ?? '' })));
  });
  app.post('/api/payroll-periods', { preHandler: requirePermission('payroll.create') }, async req => {
    const b = z.object({ name: z.string().trim().min(1).max(120), from: DATE, to: DATE }).refine(x => x.from <= x.to, 'Từ ngày phải trước đến ngày').parse(req.body);
    const u = user(req);
    return db.$transaction(async tx => {
      const p = await tx.payrollPeriod.create({ data: { ...b, code: await nextCode(tx, 'BL'), branchId: u.branchId, createdById: u.id } });
      await generatePaysheets(tx, p.id);
      await audit(tx, req.auditCtx, { action: 'create', entity: 'PayrollPeriod', entityId: p.id, entityCode: p.code, summary: `Tạo bảng lương ${p.name} (${b.from} → ${b.to})` });
      return p;
    }, { timeout: 30_000 });
  });
  app.post('/api/payroll-periods/:id/regenerate', { preHandler: requirePermission('payroll.edit') }, async req =>
    db.$transaction(async tx => {
      const p = await assertDraft(tx, idOf(req), user(req).branchId);
      await generatePaysheets(tx, p.id);
      return { ok: true };
    }, { timeout: 30_000 }));
  app.post('/api/payroll-periods/:id/lock', { preHandler: requirePermission('payroll.edit') }, async req => {
    const p = await own(idOf(req), user(req).branchId);
    const r = await db.payrollPeriod.updateMany({ where: { id: p.id, status: 'draft' }, data: { status: 'locked', lockedAt: new Date() } });
    if (!r.count) throw conflict('PERIOD_LOCKED', 'Bảng lương đã chốt hoặc đã hủy');
    await audit(db, req.auditCtx, { action: 'complete', entity: 'PayrollPeriod', entityId: p.id, entityCode: p.code, summary: `Chốt bảng lương ${p.name}` });
    return db.payrollPeriod.findUniqueOrThrow({ where: { id: p.id } });
  });
  app.post('/api/payroll-periods/:id/cancel', { preHandler: requirePermission('payroll.delete') }, async req =>
    db.$transaction(async tx => {
      const p = await own(idOf(req), user(req).branchId);
      if (await tx.paysheet.count({ where: { periodId: p.id, paid: { gt: 0 } } })) throw conflict('PERIOD_PAID', 'Bảng lương đã có thanh toán, không thể hủy');
      await tx.payrollPeriod.update({ where: { id: p.id }, data: { status: 'cancelled' } });
      await audit(tx, req.auditCtx, { action: 'cancel', entity: 'PayrollPeriod', entityId: p.id, entityCode: p.code, summary: `Hủy bảng lương ${p.name}` });
      return { ok: true };
    }));

  app.put('/api/paysheets/:id', { preHandler: requirePermission('payroll.edit') }, async req => {
    const b = z.object({ bonus: moneySchema.default(0), note: z.string().max(300).default('') }).parse(req.body);
    return db.$transaction(async tx => {
      const s = await tx.paysheet.findUnique({ where: { id: idOf(req) } });
      if (!s) throw notFound('Phiếu lương');
      await assertDraft(tx, s.periodId, user(req).branchId);
      return tx.paysheet.update({ where: { id: s.id }, data: { bonus: b.bonus, note: b.note, total: Math.max(0, s.total - s.bonus + b.bonus) } });
    });
  });
  app.post('/api/paysheets/:id/pay', { preHandler: requirePermission('payroll.edit') }, async req => {
    if (!hasPerm(user(req), 'cashbook.create')) throw new AppError(403, 'FORBIDDEN', 'Cần quyền lập phiếu chi');
    const b = z.object({ amount: moneySchema, fundId: z.number().int().nullable().default(null) }).parse(req.body);
    return db.$transaction(tx => payPaysheet(tx, docCtx(req), idOf(req), b.amount, b.fundId));
  });
}
