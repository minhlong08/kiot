import { WEEKDAY_LABELS, bucketKey, groupFacts } from '@pd/shared';
import { allFacts, type Fact } from '../services/reportFacts';
import { margin, register, totalsOf, type Column, type ReportCtx } from './types';

const range = (c: ReportCtx) => ({ from: c.from, to: c.to, branchId: c.branchId });
/** Revenue/returns/net/cost/profit of a group of facts. */
function money(facts: Fact[]) {
  const revenue = facts.filter(f => f.kind === 'sale').reduce((s, f) => s + f.revenue, 0);
  const returns = facts.filter(f => f.kind === 'return').reduce((s, f) => s - f.revenue, 0);
  const cost = facts.reduce((s, f) => s + f.cost, 0);
  return { revenue, returns, net: revenue - returns, cost, profit: revenue - returns - cost, invoices: new Set(facts.filter(f => f.kind === 'sale').map(f => f.docId)).size };
}
export const MONEY_COLUMNS: Column[] = [
  { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'returns', label: 'Giá trị trả', money: true }, { key: 'net', label: 'Doanh thu thuần', money: true },
  { key: 'cost', label: 'Giá vốn', money: true, cost: true }, { key: 'profit', label: 'Lợi nhuận gộp', money: true, cost: true }, { key: 'invoices', label: 'Số hóa đơn', number: true },
];
function by<T extends string | number>(facts: Fact[], keyOf: (f: Fact) => T) {
  const m = new Map<T, Fact[]>();
  for (const f of facts) { const k = keyOf(f); m.set(k, [...(m.get(k) ?? []), f]); }
  return m;
}

register('sales-by-time', async c => {
  const unit = (['day', 'hour', 'weekday', 'month'].includes(String(c.q.by)) ? c.q.by : 'day') as 'day' | 'hour' | 'weekday' | 'month';
  const groups = by(await allFacts(c.db, range(c)), f => bucketKey(f.at, unit));
  const label = (k: string) => (unit === 'hour' ? `${k}h` : unit === 'weekday' ? WEEKDAY_LABELS[k] : unit === 'day' ? `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}` : `${k.slice(5, 7)}/${k.slice(0, 4)}`);
  const rows = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, fs]) => ({ key, label: label(key), ...money(fs) }));
  const columns: Column[] = [{ key: 'label', label: 'Thời gian' }, ...MONEY_COLUMNS];
  return { title: 'Bán hàng theo thời gian', columns, rows, totals: totalsOf(columns, rows), chart: { type: 'bar', labels: rows.map(r => r.label), series: [{ name: 'Doanh thu thuần', values: rows.map(r => r.net) }, { name: 'Lợi nhuận gộp', values: rows.map(r => r.profit) }] } };
});

register('sales-profit', async c => {
  const facts = (await allFacts(c.db, range(c))).filter(f => f.kind === 'sale');
  const groups = by(facts, f => f.docId);
  const customers = await c.db.customer.findMany({ where: { id: { in: facts.map(f => f.customerId).filter((x): x is number => !!x) } }, select: { id: true, name: true } });
  const rows = [...groups.values()].map(fs => {
    const m = money(fs);
    return { code: fs[0].docCode, at: fs[0].at, customer: customers.find(x => x.id === fs[0].customerId)?.name ?? 'Khách lẻ', gross: fs.reduce((s, f) => s + f.gross, 0), discount: fs.reduce((s, f) => s + f.discount, 0), revenue: m.revenue, cost: m.cost, profit: m.profit, margin: margin(m.profit, m.revenue) };
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
  const columns: Column[] = [{ key: 'code', label: 'Mã hóa đơn' }, { key: 'at', label: 'Thời gian' }, { key: 'customer', label: 'Khách hàng' }, { key: 'gross', label: 'Tổng tiền hàng', money: true }, { key: 'discount', label: 'Giảm giá', money: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'cost', label: 'Giá vốn', money: true, cost: true }, { key: 'profit', label: 'Lợi nhuận gộp', money: true, cost: true }, { key: 'margin', label: 'Tỷ suất (%)', percent: true, cost: true }];
  const totals = totalsOf(columns, rows);
  return { title: 'Lợi nhuận theo hóa đơn', columns, rows, totals: { ...totals, margin: margin(totals.profit, totals.revenue) } };
});

register('sales-discount', async c => {
  const invoices = await c.db.invoice.findMany({ where: { status: 'completed', createdAt: { gte: c.from, lt: c.to }, ...(c.branchId ? { branchId: c.branchId } : {}) }, include: { lines: { select: { discount: true } } }, orderBy: { createdAt: 'desc' } });
  const rows = invoices.map(i => ({ code: i.code, at: i.createdAt, subtotal: i.subtotal, lineDiscount: i.lines.reduce((s, l) => s + l.discount, 0), promo: i.promoDiscount, invoiceDiscount: i.invoiceDiscount, voucher: i.voucherDiscount, points: i.pointsValue, total: i.total }))
    .filter(r => r.lineDiscount || r.promo || r.invoiceDiscount || r.voucher || r.points);
  const columns: Column[] = [{ key: 'code', label: 'Mã hóa đơn' }, { key: 'at', label: 'Thời gian' }, { key: 'subtotal', label: 'Tổng tiền hàng', money: true }, { key: 'lineDiscount', label: 'Giảm giá dòng', money: true }, { key: 'promo', label: 'Khuyến mại', money: true }, { key: 'invoiceDiscount', label: 'Giảm giá hóa đơn', money: true }, { key: 'voucher', label: 'Voucher', money: true }, { key: 'points', label: 'Thanh toán điểm', money: true }, { key: 'total', label: 'Khách cần trả', money: true }];
  return { title: 'Bán hàng theo giảm giá', columns, rows, totals: totalsOf(columns, rows) };
});

register('sales-returns', async c => {
  const rets = await c.db.saleReturn.findMany({ where: { status: 'completed', createdAt: { gte: c.from, lt: c.to }, ...(c.branchId ? { branchId: c.branchId } : {}) }, orderBy: { createdAt: 'desc' } });
  const [invoices, customers] = await Promise.all([
    c.db.invoice.findMany({ where: { id: { in: rets.map(r => r.invoiceId).filter((x): x is number => !!x) } }, select: { id: true, code: true } }),
    c.db.customer.findMany({ where: { id: { in: rets.map(r => r.customerId).filter((x): x is number => !!x) } }, select: { id: true, name: true } }),
  ]);
  const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', debt: 'Trừ công nợ', exchange: 'Đổi hàng' };
  const rows = rets.map(r => ({ code: r.code, at: r.createdAt, invoice: invoices.find(i => i.id === r.invoiceId)?.code ?? 'Trả nhanh', customer: customers.find(x => x.id === r.customerId)?.name ?? 'Khách lẻ', subtotal: r.subtotal, returnFee: r.returnFee, total: r.total, refunded: r.refunded, method: METHOD[r.refundMethod] ?? r.refundMethod }));
  const columns: Column[] = [{ key: 'code', label: 'Mã trả hàng' }, { key: 'at', label: 'Thời gian' }, { key: 'invoice', label: 'Hóa đơn' }, { key: 'customer', label: 'Khách hàng' }, { key: 'subtotal', label: 'Tiền hàng trả', money: true }, { key: 'returnFee', label: 'Phí trả hàng', money: true }, { key: 'total', label: 'Cần trả khách', money: true }, { key: 'refunded', label: 'Đã trả khách', money: true }, { key: 'method', label: 'Hình thức' }];
  return { title: 'Bán hàng theo trả hàng', columns, rows, totals: totalsOf(columns, rows) };
});

async function grouped(c: ReportCtx, title: string, keyLabel: string, keyOf: (f: Fact) => number | string | null, nameOf: (keys: (number | string)[]) => Promise<(k: number | string) => string>) {
  const facts = (await allFacts(c.db, range(c))).filter(f => keyOf(f) !== null);
  const groups = by(facts, f => keyOf(f)!);
  const name = await nameOf([...groups.keys()]);
  const rows: (Record<string, unknown> & ReturnType<typeof money>)[] = [...groups.entries()].map(([k, fs]) => ({ key: k, [keyLabel]: name(k), ...money(fs) })).sort((a, b) => b.net - a.net);
  const columns: Column[] = [{ key: keyLabel, label: title.split(' theo ')[1]?.replace(/^./, s => s.toUpperCase()) ?? keyLabel }, ...MONEY_COLUMNS];
  return { title, columns, rows, totals: totalsOf(columns, rows), chart: { type: 'hbar' as const, labels: rows.map(r => String(r[keyLabel])), series: [{ name: 'Doanh thu thuần', values: rows.map(r => r.net) }] } };
}
register('sales-by-staff', c => grouped(c, 'Bán hàng theo nhân viên', 'staff', f => (c.q.role === 'creator' ? f.createdById : f.sellerId), async ids => {
  const us = await c.db.user.findMany({ where: { id: { in: ids.map(Number) } }, select: { id: true, fullName: true } });
  return k => us.find(u => u.id === Number(k))?.fullName ?? '';
}));
register('sales-by-branch', c => grouped({ ...c, branchId: c.user.isAdmin ? null : c.branchId }, 'Bán hàng theo chi nhánh', 'branch', f => f.branchId, async ids => {
  const bs = await c.db.branch.findMany({ where: { id: { in: ids.map(Number) } }, select: { id: true, name: true } });
  return k => bs.find(b => b.id === Number(k))?.name ?? '';
}));
register('channels', async c => {
  const r = await grouped(c, 'Doanh thu theo kênh bán', 'channel', f => f.channel, async () => {
    const chs = await c.db.salesChannel.findMany();
    return k => chs.find(x => x.code === k)?.name ?? String(k);
  });
  r.rows.sort((a, b) => b.net - a.net || String(a.channel).localeCompare(String(b.channel)));
  return r;
});

register('orders-by-product', async c => {
  const lines = await c.db.customerOrderLine.findMany({ where: { order: { createdAt: { gte: c.from, lt: c.to }, status: { notIn: ['cancelled', 'draft'] }, ...(c.branchId ? { branchId: c.branchId } : {}) } } });
  const ps = await c.db.product.findMany({ where: { id: { in: lines.map(l => l.productId) } }, select: { id: true, code: true, name: true } });
  const byProduct = new Map<number, typeof lines>();
  for (const l of lines) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  const rows = [...byProduct.entries()].map(([pid, xs]) => {
    const ordered = xs.reduce((s, l) => s + l.qty, 0), delivered = xs.reduce((s, l) => s + l.deliveredQty, 0);
    return { code: ps.find(p => p.id === pid)?.code, name: ps.find(p => p.id === pid)?.name, ordered, delivered, remaining: ordered - delivered, value: xs.reduce((s, l) => s + l.qty * l.price - l.discount, 0) };
  }).sort((a, b) => b.ordered - a.ordered);
  const columns: Column[] = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'ordered', label: 'SL đặt', number: true }, { key: 'delivered', label: 'SL đã giao', number: true }, { key: 'remaining', label: 'SL còn lại', number: true }, { key: 'value', label: 'Giá trị đặt', money: true }];
  return { title: 'Đặt hàng theo hàng hóa', columns, rows, totals: totalsOf(columns, rows) };
});

register('orders-by-transaction', async c => {
  const orders = await c.db.customerOrder.findMany({ where: { createdAt: { gte: c.from, lt: c.to }, status: { not: 'draft' }, ...(c.branchId ? { branchId: c.branchId } : {}) }, orderBy: { createdAt: 'desc' } });
  const cs = await c.db.customer.findMany({ where: { id: { in: orders.map(o => o.customerId).filter((x): x is number => !!x) } }, select: { id: true, name: true } });
  const STATUS: Record<string, string> = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', partial: 'Giao một phần', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
  const rows = orders.map(o => ({ code: o.code, at: o.createdAt, customer: cs.find(x => x.id === o.customerId)?.name ?? 'Khách lẻ', channel: o.channel, total: o.total, deposit: o.deposit, status: STATUS[o.status] ?? o.status }));
  const columns: Column[] = [{ key: 'code', label: 'Mã đặt hàng' }, { key: 'at', label: 'Thời gian' }, { key: 'customer', label: 'Khách hàng' }, { key: 'channel', label: 'Kênh' }, { key: 'total', label: 'Tổng tiền', money: true }, { key: 'deposit', label: 'Đặt cọc', money: true }, { key: 'status', label: 'Trạng thái' }];
  return { title: 'Đặt hàng theo giao dịch', columns, rows, totals: totalsOf(columns, rows) };
});
