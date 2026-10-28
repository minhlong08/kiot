import type { FastifyInstance } from 'fastify';
import { commissionTableInputSchema, salaryTemplateInputSchema } from '@pd/shared';
import { requirePermission } from '../plugins/auth';
import { notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { idOf } from './purchasing';

const tplOut = (t: { allowances: string; deductions: string }) => ({ ...t, allowances: JSON.parse(t.allowances), deductions: JSON.parse(t.deductions) });
const tableOut = (t: { rules: string }) => ({ ...t, rules: JSON.parse(t.rules) });

/** Salary templates and commission tables used when payroll periods generate paysheets. */
export async function payrollSetupRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/salary-templates', { preHandler: requirePermission('payroll.view', 'employees.view') }, async () => (await db.salaryTemplate.findMany({ orderBy: { name: 'asc' } })).map(tplOut));
  const saveTemplate = async (body: unknown, ctx: Parameters<typeof audit>[1], id?: number) => {
    const d = salaryTemplateInputSchema.parse(body);
    const data = { ...d, allowances: JSON.stringify(d.allowances), deductions: JSON.stringify(d.deductions) };
    if (id && !(await db.salaryTemplate.findUnique({ where: { id } }))) throw notFound('Mẫu lương');
    const t = id ? await db.salaryTemplate.update({ where: { id }, data }) : await db.salaryTemplate.create({ data });
    await audit(db, ctx, { action: id ? 'update' : 'create', entity: 'SalaryTemplate', entityId: t.id, entityCode: t.name, summary: `${id ? 'Sửa' : 'Tạo'} mẫu lương ${t.name}` });
    return tplOut(t);
  };
  app.post('/api/salary-templates', { preHandler: requirePermission('payroll.create', 'payroll.edit') }, async req => saveTemplate(req.body, req.auditCtx));
  app.put('/api/salary-templates/:id', { preHandler: requirePermission('payroll.edit') }, async req => saveTemplate(req.body, req.auditCtx, idOf(req)));
  app.delete('/api/salary-templates/:id', { preHandler: requirePermission('payroll.delete') }, async req => {
    const t = await db.salaryTemplate.findUnique({ where: { id: idOf(req) } });
    if (!t) throw notFound('Mẫu lương');
    if (await db.employee.count({ where: { salaryTemplateId: t.id } })) { await db.salaryTemplate.update({ where: { id: t.id }, data: { isActive: false } }); return { deactivated: true }; }
    await db.salaryTemplate.delete({ where: { id: t.id } });
    return { deleted: true };
  });

  app.get('/api/commission-tables', { preHandler: requirePermission('payroll.view', 'employees.view') }, async () => (await db.commissionTable.findMany({ orderBy: { name: 'asc' } })).map(tableOut));
  const saveTable = async (body: unknown, ctx: Parameters<typeof audit>[1], id?: number) => {
    const d = commissionTableInputSchema.parse(body);
    const data = { ...d, rules: JSON.stringify(d.rules) };
    if (id && !(await db.commissionTable.findUnique({ where: { id } }))) throw notFound('Bảng hoa hồng');
    const t = id ? await db.commissionTable.update({ where: { id }, data }) : await db.commissionTable.create({ data });
    await audit(db, ctx, { action: id ? 'update' : 'create', entity: 'CommissionTable', entityId: t.id, entityCode: t.name, summary: `${id ? 'Sửa' : 'Tạo'} bảng hoa hồng ${t.name}` });
    return tableOut(t);
  };
  app.post('/api/commission-tables', { preHandler: requirePermission('payroll.create', 'payroll.edit') }, async req => saveTable(req.body, req.auditCtx));
  app.put('/api/commission-tables/:id', { preHandler: requirePermission('payroll.edit') }, async req => saveTable(req.body, req.auditCtx, idOf(req)));
  app.delete('/api/commission-tables/:id', { preHandler: requirePermission('payroll.delete') }, async req => {
    const t = await db.commissionTable.findUnique({ where: { id: idOf(req) } });
    if (!t) throw notFound('Bảng hoa hồng');
    if (await db.employee.count({ where: { commissionTableId: t.id } })) { await db.commissionTable.update({ where: { id: t.id }, data: { isActive: false } }); return { deactivated: true }; }
    await db.commissionTable.delete({ where: { id: t.id } });
    return { deleted: true };
  });
}
