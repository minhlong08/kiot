import { commissionFor, computePaysheet, type CommissionRule } from '@pd/shared';
import type { Tx } from '../db';
import { AppError, conflict, notFound } from '../lib/errors';
import { audit } from './audit';
import { recordCash } from './cash';
import { nextCode } from './codes';
import { getSettings } from './settings';
import type { DocCtx } from './stockDocs';
import { allocate } from './tax';
import { timesheetSummary } from './timesheets';

/** Local dates [from, to] as a UTC range (Vietnam time). */
export const dayRange = (from: string, to: string) => ({ gte: new Date(Date.parse(`${from}T00:00:00Z`) - 7 * 3600_000), lt: new Date(Date.parse(`${to}T00:00:00Z`) + 17 * 3600_000) });

/** Net sales lines credited to a seller in the period: their completed invoices minus returns made in the period. */
export async function sellerLines(tx: Tx, branchId: number, userId: number, from: string, to: string) {
  const range = dayRange(from, to);
  const invoices = await tx.invoice.findMany({ where: { branchId, sellerId: userId, status: 'completed', createdAt: range }, select: { total: true, lines: { select: { productId: true, qty: true, conversion: true, amount: true } } } });
  const sold = await tx.invoice.findMany({ where: { branchId, sellerId: userId }, select: { id: true } });
  const returns = await tx.saleReturn.findMany({ where: { status: 'completed', invoiceId: { in: sold.map(i => i.id) }, createdAt: range }, select: { total: true, lines: { select: { productId: true, qty: true, conversion: true, amount: true } } } });
  const products = await tx.product.findMany({ where: { id: { in: [...invoices, ...returns].flatMap(d => d.lines.map(l => l.productId)) } }, select: { id: true, groupId: true } });
  const out: { productId: number; groupId: number | null; qty: number; amount: number }[] = [];
  const push = (d: { total: number; lines: { productId: number; qty: number; conversion: number; amount: number }[] }, sign: 1 | -1) =>
    allocate(d.lines.map(l => l.amount), d.total).forEach((amount, i) => out.push({ productId: d.lines[i].productId, groupId: products.find(p => p.id === d.lines[i].productId)?.groupId ?? null, qty: sign * d.lines[i].qty * d.lines[i].conversion, amount: sign * amount }));
  invoices.forEach(i => push(i, 1));
  returns.forEach(r => push(r, -1));
  return out;
}

/** (Re)builds the paysheets of a draft period; keeps bonuses/notes typed by hand and paysheets already paid. */
export async function generatePaysheets(tx: Tx, periodId: number) {
  const period = await tx.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const s = await getSettings(tx);
  const employees = await tx.employee.findMany({ where: { branchId: period.branchId, isActive: true, salaryTemplateId: { not: null } } });
  const [templates, tables, summary, existing] = await Promise.all([
    tx.salaryTemplate.findMany({ where: { id: { in: employees.map(e => e.salaryTemplateId!) } } }),
    tx.commissionTable.findMany({ where: { id: { in: employees.map(e => e.commissionTableId).filter((x): x is number => !!x) }, isActive: true } }),
    timesheetSummary(tx, employees.map(e => e.id), period.from, period.to),
    tx.paysheet.findMany({ where: { periodId } }),
  ]);
  for (const e of employees) {
    const tpl = templates.find(x => x.id === e.salaryTemplateId)!;
    const table = tables.find(x => x.id === e.commissionTableId);
    const commission = e.userId && table ? Math.max(0, commissionFor(await sellerLines(tx, period.branchId, e.userId, period.from, period.to), JSON.parse(table.rules) as CommissionRule[])) : 0;
    const cur = existing.find(x => x.employeeId === e.id);
    const att = summary.find(x => x.employeeId === e.id)!;
    const r = computePaysheet({
      template: { mode: tpl.mode as 'monthly' | 'perShift' | 'perHour', amount: tpl.amount, overtimeRate: tpl.overtimeRate, allowances: JSON.parse(tpl.allowances), deductions: JSON.parse(tpl.deductions) },
      attendance: att, standardDays: s.staff.standardDays, commission, bonus: cur?.bonus ?? 0,
    });
    const data = { base: r.base, overtime: r.overtime, allowance: r.allowance, deduction: r.deduction, commission: r.commission, bonus: r.bonus, total: r.total, detail: JSON.stringify({ lines: r.lines, attendance: att, template: tpl.name }) };
    if (cur) await tx.paysheet.update({ where: { id: cur.id }, data });
    else await tx.paysheet.create({ data: { ...data, code: await nextCode(tx, 'PL'), periodId, employeeId: e.id } });
  }
  await tx.paysheet.deleteMany({ where: { periodId, paid: 0, employeeId: { notIn: employees.map(e => e.id) } } });
}

export async function assertDraft(tx: Tx, periodId: number, branchId: number) {
  const p = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!p || p.branchId !== branchId) throw notFound('Bảng lương');
  if (p.status !== 'draft') throw conflict('PERIOD_LOCKED', 'Bảng lương đã chốt hoặc đã hủy');
  return p;
}

/** One payment towards a paysheet: conditional on the remaining amount, recorded as a "Chi lương" cash voucher. */
export async function payPaysheet(tx: Tx, ctx: DocCtx, id: number, amount: number, fundId: number | null) {
  const sheet = await tx.paysheet.findUnique({ where: { id } });
  const period = sheet && await tx.payrollPeriod.findUnique({ where: { id: sheet.periodId } });
  if (!sheet || !period || period.branchId !== ctx.branchId) throw notFound('Phiếu lương');
  if (period.status !== 'locked') throw conflict('PERIOD_NOT_LOCKED', 'Hãy chốt bảng lương trước khi thanh toán');
  if (amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Số tiền phải lớn hơn 0');
  const r = await tx.paysheet.updateMany({ where: { id, paid: { lte: sheet.total - amount } }, data: { paid: { increment: amount } } });
  if (!r.count) throw conflict('OVERPAY', `Số tiền vượt quá số còn phải trả (${(sheet.total - sheet.paid).toLocaleString('en-US')})`);
  const e = await tx.employee.findUniqueOrThrow({ where: { id: sheet.employeeId } });
  await recordCash(tx, ctx, {
    kind: 'out', amount, fundId, categoryName: 'Chi lương', counterpartyType: 'employee', counterpartyId: e.id, counterpartyName: e.name,
    sourceType: 'payroll', sourceId: sheet.id, sourceCode: sheet.code, codePrefix: 'PCPL', note: `Trả lương ${period.name} - ${e.name}`,
  });
  await audit(tx, ctx, { action: 'update', entity: 'Paysheet', entityId: sheet.id, entityCode: sheet.code, summary: `Trả lương ${e.name}: ${amount.toLocaleString('en-US')}` });
  return tx.paysheet.findUniqueOrThrow({ where: { id } });
}
