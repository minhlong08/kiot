import { normalizeVi, supplierInputSchema, type SupplierInput } from '@pd/shared';
import type { Tx } from '../db';
import type { XlsxColumn } from '../lib/excel';
import { docCode } from '../lib/docs';
import { notFound } from '../lib/errors';
import { audit, type AuditCtx } from './audit';
import { getSettings } from './settings';
import { postPartnerLedger } from './partnerLedger';
import { recordCash, type CashCtx } from './cash';
import { nextCode } from './codes';

export const supplierSearchText = (s: { code: string; name: string; phone: string; company?: string }) => normalizeVi(`${s.code} ${s.name} ${s.phone} ${s.company ?? ''}`);

export async function saveSupplier(tx: Tx, ctx: AuditCtx, input: SupplierInput, id?: number) {
  const before = id ? await tx.supplier.findUnique({ where: { id } }) : null;
  if (id && !before) throw notFound('Nhà cung cấp');
  const prefix = (await getSettings(tx)).orders.codePrefixes.supplier;
  // Editing keeps the code unless a different one is typed; creating takes the typed or next automatic code.
  const keep = before && (!input.code || input.code === before.code);
  const code = keep ? before.code : await docCode(tx, prefix, input.code, async c => !!(await tx.supplier.findUnique({ where: { code: c } })));
  const { code: _c, ...rest } = input;
  const data = { ...rest, groupId: input.groupId ?? null, code, searchText: supplierSearchText({ ...input, code }) };
  const s = id ? await tx.supplier.update({ where: { id }, data }) : await tx.supplier.create({ data });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'Supplier', entityId: s.id, entityCode: s.code, summary: `${id ? 'Cập nhật' : 'Thêm mới'} nhà cung cấp ${s.code} - ${s.name}`, before: before ?? undefined, after: s });
  return s;
}

/** Net purchases per supplier (completed receipts − completed returns), optionally within a date window. */
export async function purchaseTotals(tx: Tx, from?: Date, to?: Date, supplierIds?: number[]) {
  const date = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {};
  const ids = supplierIds ? { supplierId: { in: supplierIds } } : {};
  const [rec, ret] = await Promise.all([
    tx.purchaseReceipt.groupBy({ by: ['supplierId'], _sum: { total: true }, where: { status: 'completed', ...date, ...ids } }),
    tx.purchaseReturn.groupBy({ by: ['supplierId'], _sum: { total: true }, where: { status: 'completed', ...date, ...ids } }),
  ]);
  const out = new Map<number, number>();
  for (const r of rec) out.set(r.supplierId, (out.get(r.supplierId) ?? 0) + (r._sum.total ?? 0));
  for (const r of ret) out.set(r.supplierId, (out.get(r.supplierId) ?? 0) - (r._sum.total ?? 0));
  return out;
}

export async function paySupplier(tx: Tx, ctx: CashCtx, supplierId: number, p: { amount: number; fundId?: number | null; note?: string; at?: Date }) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound('Nhà cung cấp');
  const v = await recordCash(tx, ctx, {
    kind: 'out', amount: p.amount, fundId: p.fundId, categoryName: 'Chi tiền trả NCC', counterpartyType: 'supplier', counterpartyId: s.id,
    counterpartyName: s.name, sourceType: 'supplierPayment', codePrefix: 'TTNCC', note: p.note, at: p.at,
  });
  await tx.cashVoucher.update({ where: { id: v!.id }, data: { sourceId: v!.id, sourceCode: v!.code } });
  await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: s.id, amount: -p.amount, docType: 'supplierPayment', docId: v!.id, docCode: v!.code, note: p.note, at: p.at });
  return v!;
}

export async function adjustSupplierDebt(tx: Tx, ctx: AuditCtx, supplierId: number, newDebt: number, note: string) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw notFound('Nhà cung cấp');
  const code = await nextCode(tx, 'DCNCC');
  await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: s.id, amount: newDebt - s.debt, docType: 'debtAdjust', docId: s.id, docCode: code, note });
  await audit(tx, ctx, { action: 'update', entity: 'Supplier', entityId: s.id, entityCode: s.code, summary: `Điều chỉnh công nợ ${s.code} từ ${s.debt.toLocaleString('en-US')} thành ${newDebt.toLocaleString('en-US')}`, before: { debt: s.debt }, after: { debt: newDebt } });
}

export const SUPPLIER_IMPORT_COLUMNS: XlsxColumn[] = [
  { header: 'Mã nhà cung cấp', key: 'code' }, { header: 'Tên nhà cung cấp', key: 'name', width: 30 }, { header: 'Điện thoại', key: 'phone' },
  { header: 'Email', key: 'email', width: 24 }, { header: 'Mã số thuế', key: 'taxCode' }, { header: 'Địa chỉ', key: 'address', width: 40 },
  { header: 'Công ty', key: 'company', width: 30 }, { header: 'Nhóm nhà cung cấp', key: 'group' }, { header: 'Ghi chú', key: 'note', width: 30 },
];

export async function importSuppliers(tx: Tx, ctx: AuditCtx, raw: Record<string, unknown>[]) {
  const col = (r: Record<string, unknown>, key: string) => String(r[SUPPLIER_IMPORT_COLUMNS.find(c => c.key === key)!.header] ?? '').trim();
  const errors: { row: number; message: string }[] = [];
  const parsed: { row: number; input: SupplierInput; group: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const row = i + 2;
    const code = col(r, 'code');
    if (code && seen.has(code)) return errors.push({ row, message: `Mã ${code} bị trùng trong file` });
    if (code) seen.add(code);
    const res = supplierInputSchema.safeParse({ code: code || undefined, name: col(r, 'name'), phone: col(r, 'phone'), email: col(r, 'email'), taxCode: col(r, 'taxCode'), address: col(r, 'address'), company: col(r, 'company'), note: col(r, 'note') });
    if (!res.success) return errors.push({ row, message: res.error.issues[0].message });
    parsed.push({ row, input: res.data, group: col(r, 'group') });
  });
  const existing = await tx.supplier.findMany({ where: { code: { in: [...seen] } }, select: { code: true } });
  for (const p of parsed) if (p.input.code && existing.some(e => e.code === p.input.code)) errors.push({ row: p.row, message: `Mã ${p.input.code} đã tồn tại` });
  if (errors.length) return { created: 0, errors: errors.sort((a, b) => a.row - b.row) };
  for (const p of parsed) {
    const groupId = p.group ? ((await tx.supplierGroup.findUnique({ where: { name: p.group } })) ?? (await tx.supplierGroup.create({ data: { name: p.group } }))).id : null;
    await saveSupplier(tx, ctx, { ...p.input, groupId });
  }
  return { created: parsed.length, errors: [] };
}
