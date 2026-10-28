import { customerInputSchema, normalizeVi, type CustomerInput } from '@pd/shared';
import type { Tx } from '../db';
import type { XlsxColumn } from '../lib/excel';
import { docCode } from '../lib/docs';
import { AppError, notFound } from '../lib/errors';
import { audit, type AuditCtx } from './audit';
import { getSettings } from './settings';
import { postPartnerLedger } from './partnerLedger';
import { postLoyalty } from './loyalty';
import { recordCash, type CashCtx } from './cash';
import { nextCode } from './codes';

export const customerSearchText = (c: { code: string; name: string; phone: string; phone2?: string; company?: string }) =>
  normalizeVi(`${c.code} ${c.name} ${c.phone} ${c.phone2 ?? ''} ${c.company ?? ''}`);

export async function saveCustomer(tx: Tx, ctx: AuditCtx, input: CustomerInput, id?: number, opts: { force?: boolean } = {}) {
  const before = id ? await tx.customer.findUnique({ where: { id } }) : null;
  if (id && !before) throw notFound('Khách hàng');
  if (input.phone && !opts.force) {
    const dup = await tx.customer.findFirst({ where: { OR: [{ phone: input.phone }, { phone2: input.phone }], ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new AppError(409, 'DUPLICATE_PHONE', `Số điện thoại đã dùng cho khách ${dup.code} - ${dup.name}`, { code: dup.code, name: dup.name });
  }
  const prefix = (await getSettings(tx)).orders.codePrefixes.customer;
  const keep = before && (!input.code || input.code === before.code);
  const code = keep ? before.code : await docCode(tx, prefix, input.code, async c => !!(await tx.customer.findUnique({ where: { code: c } })));
  const { code: _c, birthday, ...rest } = input;
  const bday = birthday ? new Date(`${birthday}T00:00:00Z`) : null;
  const data = { ...rest, groupId: input.groupId ?? null, code, birthday: bday, birthMonth: bday ? bday.getUTCMonth() + 1 : null, searchText: customerSearchText({ ...input, code }) };
  const c = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data: { ...data, createdById: ctx.userId } });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'Customer', entityId: c.id, entityCode: c.code, summary: `${id ? 'Cập nhật' : 'Thêm mới'} khách hàng ${c.code} - ${c.name}`, before: before ?? undefined, after: c });
  return c;
}

export async function receiveCustomerPayment(tx: Tx, ctx: CashCtx, customerId: number, p: { amount: number; fundId?: number | null; note?: string; at?: Date }) {
  const c = await tx.customer.findUnique({ where: { id: customerId } });
  if (!c) throw notFound('Khách hàng');
  const v = (await recordCash(tx, ctx, { kind: 'in', amount: p.amount, fundId: p.fundId, categoryName: 'Thu tiền khách trả', counterpartyType: 'customer', counterpartyId: c.id, counterpartyName: c.name, sourceType: 'customerPayment', codePrefix: 'TTKH', note: p.note, at: p.at }))!;
  await tx.cashVoucher.update({ where: { id: v.id }, data: { sourceId: v.id, sourceCode: v.code } });
  await postPartnerLedger(tx, { partnerType: 'customer', partnerId: c.id, amount: -p.amount, docType: 'customerPayment', docId: v.id, docCode: v.code, note: p.note, at: p.at });
  return v;
}

export async function adjustCustomerDebt(tx: Tx, ctx: AuditCtx, id: number, newDebt: number, note: string) {
  const c = await tx.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Khách hàng');
  await postPartnerLedger(tx, { partnerType: 'customer', partnerId: id, amount: newDebt - c.debt, docType: 'debtAdjust', docId: id, docCode: await nextCode(tx, 'DCKH'), note });
  await audit(tx, ctx, { action: 'update', entity: 'Customer', entityId: id, entityCode: c.code, summary: `Điều chỉnh công nợ ${c.code}: ${c.debt.toLocaleString('en-US')} → ${newDebt.toLocaleString('en-US')}`, before: { debt: c.debt }, after: { debt: newDebt } });
}

export async function adjustCustomerPoints(tx: Tx, ctx: AuditCtx, id: number, newPoints: number, note: string) {
  const c = await tx.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Khách hàng');
  await postLoyalty(tx, { customerId: id, points: newPoints - c.points, docType: 'pointsAdjust', docId: id, docCode: await nextCode(tx, 'DCD'), note, allowNegative: true });
  await audit(tx, ctx, { action: 'update', entity: 'Customer', entityId: id, entityCode: c.code, summary: `Điều chỉnh điểm ${c.code}: ${c.points} → ${newPoints}`, before: { points: c.points }, after: { points: newPoints } });
}

export const CUSTOMER_IMPORT_COLUMNS: XlsxColumn[] = [
  { header: 'Mã khách hàng', key: 'code' }, { header: 'Tên khách hàng', key: 'name', width: 26 }, { header: 'Điện thoại', key: 'phone' },
  { header: 'Email', key: 'email', width: 24 }, { header: 'Ngày sinh', key: 'birthday' }, { header: 'Giới tính', key: 'gender' },
  { header: 'Địa chỉ', key: 'address', width: 30 }, { header: 'Phường/Xã', key: 'ward' }, { header: 'Tỉnh/Thành', key: 'province' },
  { header: 'Nhóm khách hàng', key: 'group' }, { header: 'Mã số thuế', key: 'taxCode' }, { header: 'Ghi chú', key: 'note', width: 30 },
];

/** DD/MM/YYYY → YYYY-MM-DD, rejecting impossible dates. */
function parseVnDate(s: string): string | null | undefined {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return undefined;
  return dt.toISOString().slice(0, 10);
}

export async function importCustomers(tx: Tx, ctx: AuditCtx, raw: Record<string, unknown>[]) {
  const col = (r: Record<string, unknown>, key: string) => {
    const v = r[CUSTOMER_IMPORT_COLUMNS.find(c => c.key === key)!.header];
    return v instanceof Date ? `${v.getUTCDate()}/${v.getUTCMonth() + 1}/${v.getUTCFullYear()}` : String(v ?? '').trim();
  };
  const errors: { row: number; message: string }[] = [];
  const parsed: { row: number; input: CustomerInput; group: string }[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const row = i + 2;
    const code = col(r, 'code');
    if (code && seen.has(code)) return errors.push({ row, message: `Mã ${code} bị trùng trong file` });
    if (code) seen.add(code);
    const birthday = parseVnDate(col(r, 'birthday'));
    if (birthday === undefined) return errors.push({ row, message: 'Ngày sinh không hợp lệ (DD/MM/YYYY)' });
    const g = col(r, 'gender').toLowerCase();
    const res = customerInputSchema.safeParse({
      code: code || undefined, name: col(r, 'name'), phone: col(r, 'phone'), email: col(r, 'email'), birthday,
      gender: g === 'nam' ? 'male' : g === 'nữ' || g === 'nu' ? 'female' : '', address: col(r, 'address'), ward: col(r, 'ward'),
      province: col(r, 'province'), taxCode: col(r, 'taxCode'), note: col(r, 'note'),
    });
    if (!res.success) return errors.push({ row, message: res.error.issues[0].message });
    parsed.push({ row, input: res.data, group: col(r, 'group') });
  });
  const existing = await tx.customer.findMany({ where: { code: { in: [...seen] } }, select: { code: true } });
  for (const p of parsed) if (p.input.code && existing.some(e => e.code === p.input.code)) errors.push({ row: p.row, message: `Mã ${p.input.code} đã tồn tại` });
  if (errors.length) return { created: 0, errors: errors.sort((a, b) => a.row - b.row) };
  for (const p of parsed) {
    const groupId = p.group ? ((await tx.customerGroup.findUnique({ where: { name: p.group } })) ?? (await tx.customerGroup.create({ data: { name: p.group } }))).id : null;
    await saveCustomer(tx, ctx, { ...p.input, groupId }, undefined, { force: true });
  }
  return { created: parsed.length, errors: [] };
}

/** Moves a customer into the best auto group reached by total spend; customers in manual groups are left alone. */
export async function autoAssignGroup(tx: Tx, customerId: number) {
  const c = await tx.customer.findUnique({ where: { id: customerId } });
  if (!c) return;
  const groups = await tx.customerGroup.findMany();
  const current = groups.find(g => g.id === c.groupId);
  if (current && current.minTotalSpent === null) return;
  const best = groups.filter(g => g.minTotalSpent !== null && g.minTotalSpent <= c.totalSpent).sort((a, b) => b.minTotalSpent! - a.minTotalSpent!)[0];
  const target = best?.id ?? (current ? null : c.groupId);
  if (target !== c.groupId) await tx.customer.update({ where: { id: c.id }, data: { groupId: target } });
}
