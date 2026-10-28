import type { Tx } from '../db';
import { notFound } from '../lib/errors';
import { audit, type AuditCtx } from './audit';
import { nextCode } from './codes';

export const CASH_CATEGORIES: { kind: 'in' | 'out'; name: string; affectsPnl: boolean }[] = [
  { kind: 'in', name: 'Thu tiền khách trả', affectsPnl: false },
  { kind: 'in', name: 'Thu tiền NCC hoàn trả', affectsPnl: false },
  { kind: 'in', name: 'Thu khác', affectsPnl: true },
  { kind: 'out', name: 'Chi tiền trả NCC', affectsPnl: false },
  { kind: 'out', name: 'Chi tiền trả khách', affectsPnl: false },
  { kind: 'out', name: 'Chi phí dịch vụ', affectsPnl: true },
  { kind: 'out', name: 'Chi lương', affectsPnl: true },
  { kind: 'out', name: 'Chi khác', affectsPnl: true },
];

/** Idempotent: the default cash fund and system categories. */
export async function ensureCashDefaults(tx: Tx) {
  if (!(await tx.cashFund.count({ where: { type: 'cash' } }))) await tx.cashFund.create({ data: { type: 'cash', name: 'Tiền mặt' } });
  for (const c of CASH_CATEGORIES) {
    await tx.cashCategory.upsert({ where: { kind_name: { kind: c.kind, name: c.name } }, create: { ...c, isSystem: true }, update: {} });
  }
}

export type CashCtx = AuditCtx & { userId: number | null; branchId: number | null };

export type CashInput = {
  kind: 'in' | 'out'; amount: number; fundId?: number | null; categoryName?: string; categoryId?: number;
  counterpartyType: 'customer' | 'supplier' | 'employee' | 'other'; counterpartyId?: number | null; counterpartyName: string;
  sourceType?: string; sourceId?: number; sourceCode?: string; codePrefix: string; code?: string; note?: string; affectsPnl?: boolean; at?: Date;
};

async function defaultFund(tx: Tx, branchId: number | null) {
  return (await tx.cashFund.findFirst({ where: { type: 'cash', isActive: true, OR: [{ branchId }, { branchId: null }] }, orderBy: [{ branchId: 'desc' }, { id: 'asc' }] }))
    ?? (await ensureCashDefaults(tx), await tx.cashFund.findFirstOrThrow({ where: { type: 'cash' } }));
}

/** The only writer of cash vouchers. Amount 0 → no voucher (returns null). */
export async function recordCash(tx: Tx, ctx: CashCtx, v: CashInput) {
  if (!v.amount) return null;
  const fund = v.fundId ? await tx.cashFund.findUnique({ where: { id: v.fundId } }) : await defaultFund(tx, ctx.branchId);
  if (!fund) throw notFound('Quỹ tiền');
  const category = v.categoryId
    ? await tx.cashCategory.findUnique({ where: { id: v.categoryId } })
    : (await tx.cashCategory.findUnique({ where: { kind_name: { kind: v.kind, name: v.categoryName ?? (v.kind === 'in' ? 'Thu khác' : 'Chi khác') } } }))
      ?? (await ensureCashDefaults(tx), await tx.cashCategory.findUniqueOrThrow({ where: { kind_name: { kind: v.kind, name: v.kind === 'in' ? 'Thu khác' : 'Chi khác' } } }));
  if (!category || category.kind !== v.kind) throw notFound('Loại thu chi');
  let code = v.code;
  while (!code) {
    const c = await nextCode(tx, v.codePrefix);
    if (!(await tx.cashVoucher.findUnique({ where: { code: c } }))) code = c;
  }
  const voucher = await tx.cashVoucher.create({
    data: {
      code, kind: v.kind, fundId: fund.id, branchId: ctx.branchId ?? 0, amount: v.amount, categoryId: category.id,
      counterpartyType: v.counterpartyType, counterpartyId: v.counterpartyId ?? null, counterpartyName: v.counterpartyName,
      sourceType: v.sourceType ?? null, sourceId: v.sourceId ?? null, sourceCode: v.sourceCode ?? null, note: v.note ?? '',
      affectsPnl: v.affectsPnl ?? category.affectsPnl, createdById: ctx.userId ?? 0, ...(v.at ? { createdAt: v.at } : {}),
    },
  });
  await audit(tx, ctx, { action: 'create', entity: 'CashVoucher', entityId: voucher.id, entityCode: code, summary: `${v.kind === 'in' ? 'Phiếu thu' : 'Phiếu chi'} ${code}: ${v.amount.toLocaleString('en-US')}` });
  return voucher;
}

export async function cancelCashBySource(tx: Tx, ctx: CashCtx, sourceType: string, sourceId: number) {
  const vs = await tx.cashVoucher.findMany({ where: { sourceType, sourceId, status: 'completed' } });
  for (const v of vs) {
    await tx.cashVoucher.update({ where: { id: v.id }, data: { status: 'cancelled' } });
    await audit(tx, ctx, { action: 'cancel', entity: 'CashVoucher', entityId: v.id, entityCode: v.code, summary: `Hủy phiếu ${v.code} theo chứng từ ${v.sourceCode ?? ''}` });
  }
}

export async function fundBalance(tx: Tx, fundId: number, until?: Date): Promise<number> {
  const fund = await tx.cashFund.findUniqueOrThrow({ where: { id: fundId } });
  const where = { fundId, status: 'completed', ...(until ? { createdAt: { lt: until } } : {}) };
  const [i, o] = await Promise.all([
    tx.cashVoucher.aggregate({ _sum: { amount: true }, where: { ...where, kind: 'in' } }),
    tx.cashVoucher.aggregate({ _sum: { amount: true }, where: { ...where, kind: 'out' } }),
  ]);
  return fund.openingBalance + (i._sum.amount ?? 0) - (o._sum.amount ?? 0);
}
