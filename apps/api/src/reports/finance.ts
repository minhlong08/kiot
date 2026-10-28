import { z } from 'zod';
import type { Tx } from '../db';
import { periodSummary } from '../services/reportFacts';
import { AppError } from '../lib/errors';
import { hasPerm } from '../plugins/auth';
import { factsFor, register, type Column } from './types';

const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', points: 'Điểm', deposit: 'Tiền cọc', exchange: 'Đổi hàng', debt: 'Ghi nợ' };
const dayRange = (date: string) => ({ gte: new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 3600_000), lt: new Date(Date.parse(`${date}T00:00:00Z`) + 17 * 3600_000) });

/** Cuối ngày: what was sold and how it was paid, returns, the cash drawer, per staff, COD delivered. */
register('end-of-day', async c => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)).parse(c.q.date);
  const createdAt = dayRange(date);
  const branch = c.branchId ? { branchId: c.branchId } : {};
  const [invoices, rets, vouchers, cashFunds, delivered] = await Promise.all([
    c.db.invoice.findMany({ where: { ...branch, createdAt, status: { not: 'cancelled' } }, include: { payments: true } }),
    c.db.saleReturn.findMany({ where: { ...branch, createdAt, status: 'completed' } }),
    c.db.cashVoucher.findMany({ where: { ...branch, createdAt, status: 'completed' } }),
    c.db.cashFund.findMany({ where: { type: 'cash' }, select: { id: true } }),
    c.db.invoiceDelivery.findMany({ where: { deliveredAt: createdAt, status: 'delivered' }, select: { invoiceId: true, cod: true } }),
  ]);
  // Delivered today, in this branch (the delivery row itself has no branch).
  const deliveredHere = new Set((await c.db.invoice.findMany({ where: { id: { in: delivered.map(d => d.invoiceId) }, ...branch }, select: { id: true } })).map(i => i.id));
  const facts = await factsFor({ ...c, from: createdAt.gte, to: createdAt.lt });
  const rows: { section: string; label: string; count?: number; amount: number }[] = [];
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  // Same definitions as every other report: completed sales (goods revenue), returns at goods value.
  rows.push({ section: 'Tổng quan', label: 'Số hóa đơn', amount: new Set(facts.filter(f => f.kind === 'sale').map(f => f.docId)).size }, { section: 'Tổng quan', label: 'Doanh thu', amount: sum(facts.filter(f => f.kind === 'sale'), f => f.revenue) }, { section: 'Tổng quan', label: 'Giá trị trả hàng', amount: sum(rets, r => r.subtotal) });
  const methods = [...new Set(invoices.flatMap(i => i.payments.map(p => p.method)))];
  for (const m of methods) rows.push({ section: 'Bán hàng', label: METHOD[m] ?? m, amount: sum(invoices.flatMap(i => i.payments.filter(p => p.method === m)), p => p.amount) });
  rows.push({ section: 'Bán hàng', label: 'Ghi nợ / thu hộ (COD)', amount: sum(invoices, i => i.debt) + sum(invoices.filter(i => i.isDelivery && i.status === 'processing'), i => i.total - i.paid) });
  for (const m of [...new Set(rets.map(r => r.refundMethod))]) rows.push({ section: 'Trả hàng', label: METHOD[m] ?? m, amount: sum(rets.filter(r => r.refundMethod === m), r => r.refunded) });
  const cash = vouchers.filter(v => cashFunds.some(f => f.id === v.fundId));
  const cin = sum(cash.filter(v => v.kind === 'in'), v => v.amount), cout = sum(cash.filter(v => v.kind === 'out'), v => v.amount);
  rows.push({ section: 'Tiền mặt', label: 'Thu', amount: cin }, { section: 'Tiền mặt', label: 'Chi', amount: cout }, { section: 'Tiền mặt', label: 'Chênh lệch', amount: cin - cout });
  const other = vouchers.filter(v => !cashFunds.some(f => f.id === v.fundId));
  rows.push({ section: 'Ngân hàng / Ví', label: 'Thu', amount: sum(other.filter(v => v.kind === 'in'), v => v.amount) }, { section: 'Ngân hàng / Ví', label: 'Chi', amount: sum(other.filter(v => v.kind === 'out'), v => v.amount) });
  const mine = delivered.filter(d => deliveredHere.has(d.invoiceId));
  if (mine.length) rows.push({ section: 'Giao hàng', label: 'COD giao thành công', count: mine.length, amount: sum(mine, d => d.cod) });
  const users = await c.db.user.findMany({ where: { id: { in: facts.map(f => f.sellerId).filter((x): x is number => !!x) } }, select: { id: true, fullName: true } });
  for (const u of users) rows.push({ section: 'Nhân viên', label: u.fullName, amount: sum(facts.filter(f => f.kind === 'sale' && f.sellerId === u.id), f => f.revenue) });
  const columns: Column[] = [{ key: 'section', label: 'Nhóm' }, { key: 'label', label: 'Khoản mục' }, { key: 'count', label: 'Số lượng', number: true }, { key: 'amount', label: 'Giá trị', money: true }];
  return { title: `Báo cáo cuối ngày ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, columns, rows, totals: {} };
});

/** One month's P&L parts (Vietnam time). */
async function monthPnl(db: Tx, branchId: number | null, from: Date, to: Date) {
  const s = await periodSummary(db, { from, to, branchId });
  const branch = branchId ? { branchId } : {};
  // Each voucher carries its own P&L flag (fixed when it was written); service purchases count in full when bought, not when paid.
  const vouchers = await db.cashVoucher.findMany({ where: { ...branch, status: 'completed', affectsPnl: true, sourceType: { not: 'servicePurchase' }, createdAt: { gte: from, lt: to } }, select: { kind: true, amount: true } });
  const services = await db.servicePurchase.aggregate({ where: { ...branch, status: 'completed', createdAt: { gte: from, lt: to } }, _sum: { amount: true } });
  const fees = await db.partnerLedger.aggregate({ where: { docType: { in: ['deliveryFee', 'deliveryFee_cancel'] }, createdAt: { gte: from, lt: to } }, _sum: { amount: true } });
  const invoiceOther = await db.invoice.aggregate({ where: { ...branch, status: 'completed', createdAt: { gte: from, lt: to } }, _sum: { otherIncome: true } });
  const returnFees = await db.saleReturn.aggregate({ where: { ...branch, status: 'completed', createdAt: { gte: from, lt: to } }, _sum: { returnFee: true } });
  const expenses = vouchers.filter(v => v.kind === 'out').reduce((t, v) => t + v.amount, 0) + (services._sum.amount ?? 0) - (fees._sum.amount ?? 0);
  const otherIncome = vouchers.filter(v => v.kind === 'in').reduce((t, v) => t + v.amount, 0) + (invoiceOther._sum.otherIncome ?? 0) + (returnFees._sum.returnFee ?? 0);
  const gross = s.net - s.cost;
  return { revenue: s.revenue, returns: s.returns, net: s.net, cogs: s.cost, gross, expenses, otherIncome, profit: gross - expenses + otherIncome };
}

register('finance-pnl', async c => {
  if (!hasPerm(c.user, 'cost.view')) throw new AppError(403, 'FORBIDDEN', 'Báo cáo lãi lỗ cần quyền xem giá vốn');
  const year = z.coerce.number().int().min(2000).max(2100).catch(new Date().getUTCFullYear()).parse(c.q.year);
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => monthPnl(c.db, c.branchId, new Date(Date.UTC(year, i, 1) - 7 * 3600_000), new Date(Date.UTC(year, i + 1, 1) - 7 * 3600_000))));
  const LINES: [keyof (typeof months)[number], string, boolean][] = [
    ['revenue', 'Doanh thu bán hàng', false], ['returns', 'Giảm trừ: hàng bán bị trả lại', false], ['net', 'Doanh thu thuần', false], ['cogs', 'Giá vốn hàng bán', true],
    ['gross', 'Lợi nhuận gộp', true], ['expenses', 'Chi phí (lương, điện nước, phí giao hàng…)', false], ['otherIncome', 'Thu nhập khác', false], ['profit', 'Lợi nhuận', true],
  ];
  const mk = (i: number) => `m${String(i + 1).padStart(2, '0')}`;
  const rows = LINES.map(([key, label]) => ({ key, label, ...Object.fromEntries(months.map((m, i) => [mk(i), m[key]])), total: months.reduce((s, m) => s + m[key], 0) }));
  const columns: Column[] = [{ key: 'label', label: 'Chỉ tiêu' }, ...months.map((_, i) => ({ key: mk(i), label: `T${i + 1}`, money: true })), { key: 'total', label: `Năm ${year}`, money: true }];
  return {
    title: `Báo cáo lãi lỗ năm ${year}`, columns, rows, totals: {},
    chart: { type: 'bar', labels: months.map((_, i) => `T${i + 1}`), series: [{ name: 'Doanh thu thuần', values: months.map(m => m.net) }, { name: 'Lợi nhuận', values: months.map(m => m.profit) }] },
  };
});
