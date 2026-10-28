import { AppError } from '../lib/errors';
import { hasPerm } from '../plugins/auth';
import type { Fact } from '../services/reportFacts';
import { factsFor, margin, register, totalsOf, type Column, type ReportCtx } from './types';

function groupBy<T, K>(xs: T[], key: (x: T) => K) {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}

const DOC_LABELS: Record<string, [string, 'in' | 'out' | 'both']> = {
  receipt: ['Nhập hàng', 'in'], return: ['Khách trả hàng', 'in'], transferIn: ['Chuyển kho đến', 'in'], opening: ['Tồn đầu', 'in'],
  invoice: ['Bán hàng', 'out'], purchaseReturn: ['Trả hàng nhập', 'out'], transferOut: ['Chuyển kho đi', 'out'], writeOff: ['Xuất hủy', 'out'], internalUse: ['Xuất dùng nội bộ', 'out'],
  stockTake: ['Kiểm kho', 'both'],
};
const baseType = (docType: string) => docType.replace(/_cancel$/, '');
async function productInfo(c: ReportCtx, ids: number[]) {
  const ps = await c.db.product.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, code: true, name: true, unit: true, groupId: true } });
  const gs = await c.db.productGroup.findMany({ select: { id: true, name: true } });
  const pm = new Map(ps.map(p => [p.id, p])), gm = new Map(gs.map(g => [g.id, g.name]));
  return (id: number) => { const p = pm.get(id); return { code: p?.code ?? '', name: p?.name ?? '', unit: p?.unit ?? '', group: (p?.groupId && gm.get(p.groupId)) || '' }; };
}

/** Xuất nhập tồn from the stock ledger: opening = Σ before `from`; movements by kind; closing = opening + Σ in range. */
register('stock-movement', async c => {
  const branch = c.branchId ? { branchId: c.branchId } : {};
  const [before, within] = await Promise.all([
    c.db.stockLedger.groupBy({ by: ['productId'], where: { ...branch, createdAt: { lt: c.from } }, _sum: { qtyChange: true } }),
    c.db.stockLedger.findMany({ where: { ...branch, createdAt: { gte: c.from, lt: c.to } }, select: { productId: true, docType: true, qtyChange: true, unitCost: true } }),
  ]);
  const ids = [...new Set([...before.filter(b => b._sum.qtyChange).map(b => b.productId), ...within.map(w => w.productId)])];
  const info = await productInfo(c, ids);
  const byProduct = groupBy(within, w => w.productId), openings = new Map(before.map(b => [b.productId, b._sum.qtyChange ?? 0]));
  const rows = ids.map(id => {
    const mine = byProduct.get(id) ?? [];
    const opening = openings.get(id) ?? 0;
    // Each movement counts as in or out by its sign (a cancelled sale is an "in" of the sale kind, netted per kind below).
    const byKind: Record<string, number> = {};
    for (const m of mine) byKind[baseType(m.docType)] = (byKind[baseType(m.docType)] ?? 0) + m.qtyChange;
    const inQty = Object.values(byKind).filter(v => v > 0).reduce((s, v) => s + v, 0);
    const outQty = -Object.values(byKind).filter(v => v < 0).reduce((s, v) => s + v, 0);
    const inValue = mine.filter(m => m.qtyChange > 0).reduce((s, m) => s + m.qtyChange * m.unitCost, 0);
    const outValue = -mine.filter(m => m.qtyChange < 0).reduce((s, m) => s + m.qtyChange * m.unitCost, 0);
    const detail = Object.entries(byKind).filter(([, v]) => v).map(([k, v]) => `${DOC_LABELS[k]?.[0] ?? k}: ${v > 0 ? '+' : ''}${v}`).join(', ');
    return { productId: id, ...info(id), opening, inQty, outQty, closing: opening + inQty - outQty, inValue, outValue, detail };
  }).filter(r => r.opening || r.inQty || r.outQty).sort((a, b) => a.code.localeCompare(b.code));
  const columns: Column[] = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'unit', label: 'ĐVT' }, { key: 'opening', label: 'Tồn đầu kỳ', number: true }, { key: 'inQty', label: 'SL nhập', number: true }, { key: 'inValue', label: 'Giá trị nhập', money: true, cost: true }, { key: 'outQty', label: 'SL xuất', number: true }, { key: 'outValue', label: 'Giá trị xuất', money: true, cost: true }, { key: 'closing', label: 'Tồn cuối kỳ', number: true }, { key: 'detail', label: 'Chi tiết nhập xuất' }];
  return { title: 'Xuất nhập tồn', columns, rows, totals: totalsOf(columns, rows) };
});

register('stock-value', async c => {
  const stock = await c.db.branchStock.findMany({ where: { ...(c.branchId ? { branchId: c.branchId } : {}), onHand: { not: 0 } } });
  const info = await productInfo(c, stock.map(s => s.productId));
  const byProduct = new Map<number, { onHand: number; value: number }>();
  for (const s of stock) { const cur = byProduct.get(s.productId) ?? { onHand: 0, value: 0 }; byProduct.set(s.productId, { onHand: cur.onHand + s.onHand, value: cur.value + s.onHand * s.cost }); }
  const products = await c.db.product.findMany({ where: { id: { in: [...byProduct.keys()] } }, select: { id: true, price: true } });
  const rows = [...byProduct.entries()].map(([id, v]) => ({ productId: id, ...info(id), onHand: v.onHand, avgCost: v.onHand ? Math.round(v.value / v.onHand) : 0, value: v.value, retailValue: v.onHand * (products.find(p => p.id === id)?.price ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const columns: Column[] = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'group', label: 'Nhóm hàng' }, { key: 'onHand', label: 'Tồn kho', number: true }, { key: 'avgCost', label: 'Giá vốn', money: true, cost: true }, { key: 'value', label: 'Giá trị tồn (vốn)', money: true, cost: true }, { key: 'retailValue', label: 'Giá trị tồn (giá bán)', money: true }];
  const totals = totalsOf(columns, rows);
  delete totals.avgCost;
  return { title: 'Giá trị tồn kho', columns, rows, totals, chart: { type: 'hbar', labels: rows.slice(0, 15).map(r => r.name), series: [{ name: 'Giá trị tồn (giá bán)', values: rows.slice(0, 15).map(r => r.retailValue) }] } };
});

async function productSales(c: ReportCtx) {
  const facts = await factsFor(c);
  const info = await productInfo(c, facts.map(f => f.productId));
  return [...groupBy(facts, (f: Fact) => f.productId).entries()].map(([id, fs]) => {
    const sold = fs.filter(f => f.kind === 'sale'), ret = fs.filter(f => f.kind === 'return');
    const revenue = sold.reduce((s, f) => s + f.revenue, 0), returns = -ret.reduce((s, f) => s + f.revenue, 0), cost = fs.reduce((s, f) => s + f.cost, 0);
    return { productId: id, ...info(id), soldQty: sold.reduce((s, f) => s + f.qty, 0), returnedQty: -ret.reduce((s, f) => s + f.qty, 0), revenue, returns, net: revenue - returns, cost, profit: revenue - returns - cost, margin: margin(revenue - returns - cost, revenue - returns) };
  }).sort((a, b) => b.net - a.net);
}
register('products-sales', async c => {
  const rows = await productSales(c);
  const columns: Column[] = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'soldQty', label: 'SL bán', number: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'returnedQty', label: 'SL trả', number: true }, { key: 'returns', label: 'Giá trị trả', money: true }, { key: 'net', label: 'Doanh thu thuần', money: true }];
  return { title: 'Bán hàng theo hàng hóa', columns, rows, totals: totalsOf(columns, rows), chart: { type: 'hbar', labels: rows.slice(0, 15).map(r => r.name), series: [{ name: 'Doanh thu thuần', values: rows.slice(0, 15).map(r => r.net) }] } };
});
register('products-profit', async c => {
  const rows = (await productSales(c)).sort((a, b) => b.profit - a.profit);
  const columns: Column[] = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'soldQty', label: 'SL bán', number: true }, { key: 'net', label: 'Doanh thu thuần', money: true }, { key: 'cost', label: 'Giá vốn', money: true, cost: true }, { key: 'profit', label: 'Lợi nhuận gộp', money: true, cost: true }, { key: 'margin', label: 'Tỷ suất (%)', percent: true, cost: true }];
  const totals = totalsOf(columns, rows);
  return { title: 'Lợi nhuận theo hàng hóa', columns, rows, totals: { ...totals, margin: margin(totals.profit, totals.net) } };
});

register('write-offs', async c => {
  const issues = await c.db.stockIssue.findMany({ where: { status: 'completed', completedAt: { gte: c.from, lt: c.to }, ...(c.branchId ? { branchId: c.branchId } : {}), ...(c.q.kind ? { kind: String(c.q.kind) } : {}) }, include: { lines: true }, orderBy: { completedAt: 'desc' } });
  const info = await productInfo(c, issues.flatMap(i => i.lines.map(l => l.productId)));
  const rows = issues.flatMap(i => i.lines.map(l => ({ docCode: i.code, at: i.completedAt, kind: i.kind === 'writeOff' ? 'Xuất hủy' : 'Dùng nội bộ', reason: i.reason, ...info(l.productId), qty: l.qty, value: l.value })));
  const columns: Column[] = [{ key: 'docCode', label: 'Mã phiếu' }, { key: 'at', label: 'Thời gian' }, { key: 'kind', label: 'Loại' }, { key: 'reason', label: 'Lý do' }, { key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên hàng' }, { key: 'qty', label: 'Số lượng', number: true }, { key: 'value', label: 'Giá trị', money: true, cost: true }];
  return { title: 'Xuất hủy / dùng nội bộ', columns, rows, totals: totalsOf(columns, rows) };
});

// ── partners
async function ledgerReport(c: ReportCtx, type: 'customer' | 'supplier', title: string) {
  const [before, within] = await Promise.all([
    c.db.partnerLedger.groupBy({ by: ['partnerId'], where: { partnerType: type, createdAt: { lt: c.from } }, _sum: { amount: true } }),
    c.db.partnerLedger.findMany({ where: { partnerType: type, createdAt: { gte: c.from, lt: c.to } }, select: { partnerId: true, amount: true } }),
  ]);
  const ids = [...new Set([...before.map(b => b.partnerId), ...within.map(w => w.partnerId)])];
  const partners = type === 'customer'
    ? await c.db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true } })
    : await c.db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true } });
  const byPartner = groupBy(within, w => w.partnerId), openings = new Map(before.map(b => [b.partnerId, b._sum.amount ?? 0]));
  const rows = ids.map(id => {
    const opening = openings.get(id) ?? 0;
    const mine = byPartner.get(id) ?? [];
    const increase = mine.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0), decrease = -mine.filter(m => m.amount < 0).reduce((s, m) => s + m.amount, 0);
    const p = partners.find(x => x.id === id);
    return { partnerId: id, code: p?.code ?? '', name: p?.name ?? '', phone: p?.phone ?? '', opening, increase, decrease, closing: opening + increase - decrease };
  }).filter(r => r.opening || r.increase || r.decrease).sort((a, b) => b.closing - a.closing);
  const columns: Column[] = [{ key: 'code', label: 'Mã' }, { key: 'name', label: 'Tên' }, { key: 'phone', label: 'Điện thoại' }, { key: 'opening', label: 'Nợ đầu kỳ', money: true }, { key: 'increase', label: 'Phát sinh tăng', money: true }, { key: 'decrease', label: 'Phát sinh giảm', money: true }, { key: 'closing', label: 'Nợ cuối kỳ', money: true }];
  return { title, columns, rows, totals: totalsOf(columns, rows) };
}
register('customers-debt', c => ledgerReport(c, 'customer', 'Công nợ khách hàng'));
register('suppliers-debt', c => ledgerReport(c, 'supplier', 'Công nợ nhà cung cấp'));

register('customers-sales', async c => {
  const facts = (await factsFor(c)).filter(f => f.customerId);
  const ids = [...new Set(facts.map(f => f.customerId!))];
  const cs = await c.db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true, debt: true } });
  const byCustomer = groupBy(facts, f => f.customerId!);
  const rows = ids.map(id => {
    const fs = byCustomer.get(id) ?? [];
    const revenue = fs.filter(f => f.kind === 'sale').reduce((s, f) => s + f.revenue, 0), returns = -fs.filter(f => f.kind === 'return').reduce((s, f) => s + f.revenue, 0);
    const x = cs.find(y => y.id === id);
    return { code: x?.code ?? '', name: x?.name ?? '', phone: x?.phone ?? '', invoices: new Set(fs.filter(f => f.kind === 'sale').map(f => f.docId)).size, revenue, returns, net: revenue - returns, debt: x?.debt ?? 0 };
  }).sort((a, b) => b.net - a.net);
  const columns: Column[] = [{ key: 'code', label: 'Mã KH' }, { key: 'name', label: 'Khách hàng' }, { key: 'phone', label: 'Điện thoại' }, { key: 'invoices', label: 'Số hóa đơn', number: true }, { key: 'revenue', label: 'Doanh thu', money: true }, { key: 'returns', label: 'Giá trị trả', money: true }, { key: 'net', label: 'Doanh thu thuần', money: true }, { key: 'debt', label: 'Nợ hiện tại', money: true }];
  return { title: 'Bán hàng theo khách hàng', columns, rows, totals: totalsOf(columns, rows), chart: { type: 'hbar', labels: rows.slice(0, 15).map(r => r.name), series: [{ name: 'Doanh thu thuần', values: rows.slice(0, 15).map(r => r.net) }] } };
});

register('suppliers-purchases', async c => {
  const branch = c.branchId ? { branchId: c.branchId } : {};
  const [rec, ret] = await Promise.all([
    c.db.purchaseReceipt.findMany({ where: { ...branch, status: 'completed', createdAt: { gte: c.from, lt: c.to } }, select: { supplierId: true, total: true } }),
    c.db.purchaseReturn.findMany({ where: { ...branch, status: 'completed', createdAt: { gte: c.from, lt: c.to } }, select: { supplierId: true, total: true } }),
  ]);
  const ids = [...new Set([...rec, ...ret].map(x => x.supplierId).filter((x): x is number => !!x))];
  const ss = await c.db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, debt: true } });
  const rows = ids.map(id => {
    const purchased = rec.filter(r => r.supplierId === id).reduce((s, r) => s + r.total, 0), returned = ret.filter(r => r.supplierId === id).reduce((s, r) => s + r.total, 0);
    const x = ss.find(y => y.id === id);
    return { code: x?.code ?? '', name: x?.name ?? '', receipts: rec.filter(r => r.supplierId === id).length, purchased, returned, net: purchased - returned, debt: x?.debt ?? 0 };
  }).sort((a, b) => b.net - a.net);
  const columns: Column[] = [{ key: 'code', label: 'Mã NCC' }, { key: 'name', label: 'Nhà cung cấp' }, { key: 'receipts', label: 'Số phiếu nhập', number: true }, { key: 'purchased', label: 'Giá trị nhập', money: true }, { key: 'returned', label: 'Giá trị trả', money: true }, { key: 'net', label: 'Giá trị nhập thuần', money: true }, { key: 'debt', label: 'Nợ hiện tại', money: true }];
  return { title: 'Nhập hàng theo nhà cung cấp', columns, rows, totals: totalsOf(columns, rows) };
});

register('staff-payroll', async c => {
  if (!hasPerm(c.user, 'payroll.view')) throw new AppError(403, 'FORBIDDEN', 'Báo cáo lương cần quyền xem bảng lương');
  const toDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const periods = await c.db.payrollPeriod.findMany({ where: { ...(c.branchId ? { branchId: c.branchId } : {}), status: { not: 'cancelled' }, from: { lte: toDate(new Date(c.to.getTime() - 1)) }, to: { gte: toDate(c.from) } } });
  const sheets = await c.db.paysheet.findMany({ where: { periodId: { in: periods.map(p => p.id) } } });
  const emps = await c.db.employee.findMany({ where: { id: { in: sheets.map(s => s.employeeId) } }, select: { id: true, code: true, name: true } });
  const rows = sheets.map(s => ({ period: periods.find(p => p.id === s.periodId)?.name ?? '', code: emps.find(e => e.id === s.employeeId)?.code ?? '', name: emps.find(e => e.id === s.employeeId)?.name ?? '', base: s.base, overtime: s.overtime, allowance: s.allowance, deduction: s.deduction, commission: s.commission, bonus: s.bonus, total: s.total, paid: s.paid, remaining: s.total - s.paid }));
  const columns: Column[] = [{ key: 'period', label: 'Bảng lương' }, { key: 'code', label: 'Mã NV' }, { key: 'name', label: 'Nhân viên' }, { key: 'base', label: 'Lương chính', money: true }, { key: 'overtime', label: 'Làm thêm', money: true }, { key: 'allowance', label: 'Phụ cấp', money: true }, { key: 'deduction', label: 'Giảm trừ', money: true }, { key: 'commission', label: 'Hoa hồng', money: true }, { key: 'bonus', label: 'Thưởng', money: true }, { key: 'total', label: 'Tổng lương', money: true }, { key: 'paid', label: 'Đã trả', money: true }, { key: 'remaining', label: 'Còn cần trả', money: true }];
  return { title: 'Lương nhân viên', columns, rows, totals: totalsOf(columns, rows) };
});
