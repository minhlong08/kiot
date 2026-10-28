import type { FastifyInstance } from 'fastify';
import { bucketKey, pctChange, previousRange } from '@pd/shared';
import type { Tx } from '../db';
import { dateParam } from '../lib/list';
import { notFound } from '../lib/errors';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { allFacts, periodSummary, type Fact } from '../services/reportFacts';

type Range = { from: Date; to: Date; branchId: number | null };
const kpi = (key: string, label: string, value: number, previous: number, money = true) => ({ key, label, value, previous, change: pctChange(value, previous), money });
const days = (r: { from: Date; to: Date }) => { const out: string[] = []; for (let t = r.from.getTime(); t < r.to.getTime(); t += 86400_000) out.push(bucketKey(new Date(t), 'day')); return [...new Set(out)]; };
const sumBy = (facts: Fact[], key: (f: Fact) => string) => { const m = new Map<string, number>(); for (const f of facts) m.set(key(f), (m.get(key(f)) ?? 0) + f.revenue); return m; };

const ANALYTICS: Record<string, (db: Tx, r: Range, costView: boolean) => Promise<unknown>> = {
  /** Kinh doanh: headline KPIs vs the previous period of equal length, daily trend of both. */
  async business(db, r, costView) {
    const p = { ...previousRange(r), branchId: r.branchId };
    const [cur, prev, cf, pf] = await Promise.all([periodSummary(db, r), periodSummary(db, p), allFacts(db, r), allFacts(db, p)]);
    const avg = (s: { net: number; invoiceCount: number }) => (s.invoiceCount ? Math.round(s.net / s.invoiceCount) : 0);
    const kpis = [kpi('net', 'Doanh thu thuần', cur.net, prev.net), kpi('invoices', 'Số hóa đơn', cur.invoiceCount, prev.invoiceCount, false), kpi('avg', 'Giá trị TB / hóa đơn', avg(cur), avg(prev)), kpi('returns', 'Trả hàng', cur.returns, prev.returns)];
    if (costView) kpis.splice(1, 0, kpi('profit', 'Lợi nhuận gộp', cur.profit, prev.profit));
    const cd = days(r), pd = days(p);
    const cm = sumBy(cf, f => bucketKey(f.at, 'day')), pm = sumBy(pf, f => bucketKey(f.at, 'day'));
    return { kpis, trend: { labels: cd.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`), series: [{ name: 'Kỳ này', values: cd.map(d => cm.get(d) ?? 0) }, { name: 'Kỳ trước', values: cd.map((_, i) => pm.get(pd[i]) ?? 0) }] } };
  },
  /** Hàng hóa: best and worst sellers, slow movers (stock but no sale in 30 days), ABC by net revenue. */
  async products(db, r) {
    const facts = await allFacts(db, r);
    const net = sumBy(facts, f => String(f.productId));
    const ranked = [...net.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, v]) => s + Math.max(0, v), 0);
    let acc = 0;
    const abc = ranked.filter(([, v]) => v > 0).map(([id, v]) => { acc += v; const share = acc / (total || 1); return { productId: Number(id), net: v, cls: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C' }; });
    const since = new Date(Date.now() - 30 * 86400_000);
    const recent = await db.invoiceLine.findMany({ where: { invoice: { status: 'completed', createdAt: { gte: since }, ...(r.branchId ? { branchId: r.branchId } : {}) } }, select: { productId: true }, distinct: ['productId'] });
    const stock = await db.branchStock.findMany({ where: { onHand: { gt: 0 }, ...(r.branchId ? { branchId: r.branchId } : {}), productId: { notIn: recent.map(x => x.productId) } } });
    const ids = [...new Set([...ranked.map(([id]) => Number(id)), ...stock.map(s => s.productId)])];
    const ps = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, price: true } });
    const name = (id: number) => ps.find(p => p.id === id)?.name ?? '';
    return {
      top: ranked.slice(0, 10).map(([id, v]) => ({ name: name(Number(id)), value: v })),
      bottom: ranked.filter(([, v]) => v > 0).slice(-10).reverse().map(([id, v]) => ({ name: name(Number(id)), value: v })),
      slowMovers: stock.map(s => ({ productId: s.productId, code: ps.find(p => p.id === s.productId)?.code ?? '', name: name(s.productId), onHand: s.onHand, value: s.onHand * (ps.find(p => p.id === s.productId)?.price ?? 0) })).sort((a, b) => b.value - a.value).slice(0, 50),
      abc: abc.map(x => ({ ...x, name: name(x.productId) })),
    };
  },
  /** Khách hàng: new vs returning buyers, top customers, revenue by customer group. */
  async customers(db, r) {
    const facts = (await allFacts(db, r)).filter(f => f.customerId);
    const ids = [...new Set(facts.map(f => f.customerId!))];
    const earlier = await db.invoice.findMany({ where: { customerId: { in: ids }, status: 'completed', createdAt: { lt: r.from } }, select: { customerId: true }, distinct: ['customerId'] });
    const cs = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, groupId: true } });
    const groups = await db.customerGroup.findMany({ select: { id: true, name: true } });
    const net = sumBy(facts, f => String(f.customerId));
    const byGroup = new Map<string, number>();
    for (const c of cs) { const g = groups.find(x => x.id === c.groupId)?.name ?? 'Chưa phân nhóm'; byGroup.set(g, (byGroup.get(g) ?? 0) + (net.get(String(c.id)) ?? 0)); }
    const walkIn = await db.invoice.count({ where: { customerId: null, status: 'completed', createdAt: { gte: r.from, lt: r.to }, ...(r.branchId ? { branchId: r.branchId } : {}) } });
    return {
      kpis: [kpi('buyers', 'Khách mua hàng', ids.length, 0, false), kpi('new', 'Khách mới', ids.length - earlier.length, 0, false), kpi('returning', 'Khách quay lại', earlier.length, 0, false), kpi('walkIn', 'Hóa đơn khách lẻ', walkIn, 0, false)],
      top: [...net.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ name: cs.find(c => c.id === Number(id))?.name ?? '', value: v })),
      groups: [...byGroup.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    };
  },
  /** Hiệu quả: revenue per staff and per hour of day, order → invoice conversion. */
  async efficiency(db, r) {
    const facts = await allFacts(db, r);
    const perStaff = sumBy(facts.filter(f => f.sellerId), f => String(f.sellerId));
    const users = await db.user.findMany({ where: { id: { in: [...perStaff.keys()].map(Number) } }, select: { id: true, fullName: true } });
    const perHour = sumBy(facts, f => bucketKey(f.at, 'hour'));
    const orders = await db.customerOrder.groupBy({ by: ['status'], where: { createdAt: { gte: r.from, lt: r.to }, ...(r.branchId ? { branchId: r.branchId } : {}), status: { not: 'draft' } }, _count: { _all: true } });
    const count = (s: string[]) => orders.filter(o => s.includes(o.status)).reduce((t, o) => t + o._count._all, 0);
    const placed = count(['pending', 'confirmed', 'partial', 'completed', 'cancelled']);
    return {
      staff: [...perStaff.entries()].map(([id, v]) => ({ name: users.find(u => u.id === Number(id))?.fullName ?? '', value: v })).sort((a, b) => b.value - a.value),
      hours: { labels: Array.from({ length: 24 }, (_, h) => `${h}h`), series: [{ name: 'Doanh thu thuần', values: Array.from({ length: 24 }, (_, h) => perHour.get(String(h).padStart(2, '0')) ?? 0) }] },
      orders: { placed, completed: count(['completed']), cancelled: count(['cancelled']), conversion: placed ? Math.round((count(['completed', 'partial']) / placed) * 1000) / 10 : 0 },
    };
  },
};

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/:name', { preHandler: requirePermission('reports.view') }, async req => {
    const fn = ANALYTICS[(req.params as { name: string }).name];
    if (!fn) throw notFound('Phân tích');
    const q = req.query as Record<string, unknown>;
    const u = user(req);
    const now = new Date();
    const r = { from: dateParam(q.from) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 7 * 3600_000), to: dateParam(q.to) ?? now, branchId: q.branchId === 'all' && u.isAdmin ? null : u.branchId };
    return fn(app.prisma, r, hasPerm(u, 'cost.view'));
  });
}
