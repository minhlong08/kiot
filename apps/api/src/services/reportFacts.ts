import type { Tx } from '../db';
import { allocate } from './tax';

export type ReportRange = { from: Date; to: Date; branchId: number | null };
/** One sold (or, negative, returned) line. revenue excludes invoice "other income" (e.g. delivery charge). */
export type Fact = {
  kind: 'sale' | 'return'; at: Date; docId: number; docCode: string; invoiceId: number | null; branchId: number; sellerId: number | null; createdById: number;
  channel: string; customerId: number | null; productId: number; groupId: number | null; qty: number; gross: number; revenue: number; cost: number; discount: number; isDelivery: boolean;
};

const inRange = (r: ReportRange) => ({ createdAt: { gte: r.from, lt: r.to }, ...(r.branchId ? { branchId: r.branchId } : {}) });

async function groupsOf(tx: Tx, ids: number[]) {
  const ps = await tx.product.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, groupId: true } });
  return (id: number) => ps.find(p => p.id === id)?.groupId ?? null;
}

/** Completed invoices in range; each invoice's goods total (total − other income) is spread over its lines. */
export async function saleFacts(tx: Tx, r: ReportRange): Promise<Fact[]> {
  const invoices = await tx.invoice.findMany({ where: { ...inRange(r), status: 'completed' }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  const groupOf = await groupsOf(tx, invoices.flatMap(i => i.lines.map(l => l.productId)));
  const out: Fact[] = [];
  for (const inv of invoices) {
    const goods = allocate(inv.lines.map(l => l.amount), inv.total - inv.otherIncome);
    inv.lines.forEach((l, k) => {
      const gross = l.isGift ? 0 : l.qty * l.price;
      out.push({
        kind: 'sale', at: inv.createdAt, docId: inv.id, docCode: inv.code, invoiceId: inv.id, branchId: inv.branchId, sellerId: inv.sellerId, createdById: inv.createdById,
        channel: inv.channel, customerId: inv.customerId, productId: l.productId, groupId: groupOf(l.productId), qty: l.qty * l.conversion,
        gross, revenue: goods[k], cost: l.cost * l.qty * l.conversion, discount: gross - goods[k], isDelivery: inv.isDelivery,
      });
    });
  }
  return out;
}

/** Completed returns in range (by return date), negative; the return fee is not revenue here (it is other income). */
export async function returnFacts(tx: Tx, r: ReportRange): Promise<Fact[]> {
  const rets = await tx.saleReturn.findMany({ where: { ...inRange(r), status: 'completed' }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  const invoices = await tx.invoice.findMany({ where: { id: { in: rets.map(x => x.invoiceId).filter((x): x is number => !!x) } }, select: { id: true, sellerId: true, channel: true, isDelivery: true } });
  const groupOf = await groupsOf(tx, rets.flatMap(x => x.lines.map(l => l.productId)));
  const out: Fact[] = [];
  for (const ret of rets) {
    const inv = invoices.find(i => i.id === ret.invoiceId);
    ret.lines.forEach(l => out.push({
      kind: 'return', at: ret.createdAt, docId: ret.id, docCode: ret.code, invoiceId: ret.invoiceId, branchId: ret.branchId, sellerId: inv?.sellerId ?? null, createdById: ret.createdById,
      channel: inv?.channel ?? 'store', customerId: ret.customerId, productId: l.productId, groupId: groupOf(l.productId), qty: -l.qty * l.conversion,
      gross: -l.amount, revenue: -l.amount, cost: -l.cost * l.qty * l.conversion, discount: 0, isDelivery: inv?.isDelivery ?? false,
    }));
  }
  return out;
}

export async function allFacts(tx: Tx, r: ReportRange) {
  const [s, ret] = await Promise.all([saleFacts(tx, r), returnFacts(tx, r)]);
  return [...s, ...ret];
}

/** Doanh thu, trả hàng, thuần, giá vốn, lợi nhuận gộp, số hóa đơn. */
export async function periodSummary(tx: Tx, r: ReportRange) {
  const facts = await allFacts(tx, r);
  const revenue = facts.filter(f => f.kind === 'sale').reduce((s, f) => s + f.revenue, 0);
  const returns = facts.filter(f => f.kind === 'return').reduce((s, f) => s - f.revenue, 0);
  const cost = facts.reduce((s, f) => s + f.cost, 0);
  const invoiceCount = new Set(facts.filter(f => f.kind === 'sale').map(f => f.docId)).size;
  return { revenue, returns, net: revenue - returns, cost, profit: revenue - returns - cost, invoiceCount };
}
