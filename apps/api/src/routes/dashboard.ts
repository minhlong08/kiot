import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { PERIODS, WEEKDAY_LABELS, bucketKey, groupFacts, pctChange, periodRange, sameTimeLastMonth, formatVnd } from '@pd/shared';
import { requirePermission, user } from '../plugins/auth';
import { AppError } from '../lib/errors';
import { allFacts, periodSummary } from '../services/reportFacts';

const periodQuery = z.object({ period: z.enum(PERIODS).default('today') });
const relTime = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
};

export async function dashboardRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const pre = { preHandler: requirePermission('dashboard.view') };
  const scope = (req: Parameters<typeof user>[0]) => user(req).branchId;

  /** Today so far vs the same stretch (00:00 → same time) on the same day last month. */
  app.get('/api/dashboard/today', pre, async req => {
    const branchId = scope(req);
    const now = new Date();
    const { from } = periodRange('today', now);
    const lmNow = sameTimeLastMonth(now);
    const lmFrom = periodRange('today', lmNow).from;
    // Only sales figures: cost and profit stay behind cost.view (reports), never on the dashboard.
    const pick = (x: Awaited<ReturnType<typeof periodSummary>>) => ({ revenue: x.revenue, returns: x.returns, net: x.net, invoiceCount: x.invoiceCount });
    const [cur, prev] = (await Promise.all([periodSummary(db, { from, to: now, branchId }), periodSummary(db, { from: lmFrom, to: lmNow, branchId })])).map(pick);
    return { ...cur, previous: prev, change: { revenue: pctChange(cur.revenue, prev.revenue), returns: pctChange(cur.returns, prev.returns), net: pctChange(cur.net, prev.net) } };
  });

  app.get('/api/dashboard/chart', pre, async req => {
    const q = periodQuery.extend({ by: z.enum(['day', 'hour', 'weekday']).default('day') }).parse(req.query);
    const r = periodRange(q.period);
    const rows = groupFacts(await allFacts(db, { ...r, branchId: scope(req) }), f => bucketKey(f.at, q.by), ['revenue']);
    let keys: string[];
    if (q.by === 'hour') keys = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    else if (q.by === 'weekday') keys = ['1', '2', '3', '4', '5', '6', '7'];
    else { keys = []; for (let t = r.from.getTime(); t < r.to.getTime(); t += 86400_000) keys.push(bucketKey(new Date(t), 'day')); }
    const labels = keys.map(k => (q.by === 'hour' ? `${k}h` : q.by === 'weekday' ? WEEKDAY_LABELS[k] : `${k.slice(8, 10)}/${k.slice(5, 7)}`));
    return { labels, series: [{ name: 'Doanh thu thuần', values: keys.map(k => rows.find(x => x.key === k)?.revenue ?? 0) }] };
  });

  app.get('/api/dashboard/top-products', pre, async req => {
    const q = periodQuery.extend({ metric: z.enum(['revenue', 'qty']).default('revenue') }).parse(req.query);
    const rows = groupFacts(await allFacts(db, { ...periodRange(q.period), branchId: scope(req) }), f => String(f.productId), ['revenue', 'qty']);
    const top = rows.sort((a, b) => b[q.metric] - a[q.metric]).filter(r => r[q.metric] > 0).slice(0, 10);
    const products = await db.product.findMany({ where: { id: { in: top.map(r => Number(r.key)) } }, select: { id: true, code: true, name: true } });
    return top.map(r => ({ productId: Number(r.key), code: products.find(p => p.id === Number(r.key))?.code, name: products.find(p => p.id === Number(r.key))?.name ?? '', value: r[q.metric] }));
  });

  app.get('/api/dashboard/top-customers', pre, async req => {
    const q = periodQuery.parse(req.query);
    const rows = groupFacts((await allFacts(db, { ...periodRange(q.period), branchId: scope(req) })).filter(f => f.customerId), f => String(f.customerId), ['revenue']);
    const top = rows.sort((a, b) => b.revenue - a.revenue).filter(r => r.revenue > 0).slice(0, 10);
    const cs = await db.customer.findMany({ where: { id: { in: top.map(r => Number(r.key)) } }, select: { id: true, code: true, name: true } });
    return top.map(r => ({ customerId: Number(r.key), code: cs.find(c => c.id === Number(r.key))?.code, name: cs.find(c => c.id === Number(r.key))?.name ?? '', value: r.revenue }));
  });

  app.get('/api/dashboard/staff', pre, async req => {
    const q = periodQuery.parse(req.query);
    const rows = groupFacts((await allFacts(db, { ...periodRange(q.period), branchId: scope(req) })).filter(f => f.sellerId), f => String(f.sellerId), ['revenue']);
    const users = await db.user.findMany({ where: { id: { in: rows.map(r => Number(r.key)) } }, select: { id: true, fullName: true } });
    return rows.map(r => ({ userId: Number(r.key), name: users.find(u => u.id === Number(r.key))?.fullName ?? '', net: r.revenue })).sort((a, b) => b.net - a.net);
  });

  /** Recent sales, returns and receipts as sentences. */
  app.get('/api/dashboard/activity', pre, async req => {
    const branchId = scope(req);
    const [inv, ret, rec] = await Promise.all([
      db.invoice.findMany({ where: { branchId, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, code: true, total: true, createdAt: true, createdById: true } }),
      db.saleReturn.findMany({ where: { branchId, status: 'completed' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, code: true, total: true, createdAt: true, createdById: true } }),
      db.purchaseReceipt.findMany({ where: { branchId, status: 'completed' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, code: true, total: true, createdAt: true, createdById: true } }),
    ]);
    const users = await db.user.findMany({ where: { id: { in: [...inv, ...ret, ...rec].map(x => x.createdById) } }, select: { id: true, fullName: true } });
    const name = (id: number) => users.find(u => u.id === id)?.fullName ?? 'Nhân viên';
    return [
      ...inv.map(x => ({ kind: 'invoice', code: x.code, at: x.createdAt, text: `${name(x.createdById)} vừa bán đơn hàng với giá trị ${formatVnd(x.total)}` })),
      ...ret.map(x => ({ kind: 'return', code: x.code, at: x.createdAt, text: `${name(x.createdById)} vừa nhận trả hàng với giá trị ${formatVnd(x.total)}` })),
      ...rec.map(x => ({ kind: 'receipt', code: x.code, at: x.createdAt, text: `${name(x.createdById)} vừa nhập hàng với giá trị ${formatVnd(x.total)}` })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 20).map(a => ({ ...a, ago: relTime(a.at) }));
  });

  /** Admins only: ≥3 failed logins for one account in 24h; a successful login from an address unseen for that user in the 30 days before. */
  app.get('/api/dashboard/alerts', pre, async req => {
    if (!user(req).isAdmin) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên xem cảnh báo đăng nhập');
    const day = new Date(Date.now() - 86400_000), week = new Date(Date.now() - 7 * 86400_000);
    const failed = await db.auditLog.groupBy({ by: ['entityCode'], where: { action: 'loginFailed', createdAt: { gte: day } }, _count: { _all: true }, _max: { createdAt: true } });
    const alerts: { kind: string; username: string; count?: number; ip?: string; at: Date | null }[] = failed.filter(f => f._count._all >= 3).map(f => ({ kind: 'failedLogins', username: f.entityCode, count: f._count._all, at: f._max.createdAt }));
    // One query: logins of the last 37 days, checked in memory.
    const logins = await db.auditLog.findMany({ where: { action: 'login', createdAt: { gte: new Date(week.getTime() - 30 * 86400_000) } }, orderBy: { createdAt: 'asc' }, select: { entityId: true, entityCode: true, ip: true, createdAt: true } });
    for (const [i, l] of logins.entries()) {
      if (l.createdAt < week || !l.ip) continue;
      const earlier = logins.slice(0, i).filter(x => x.entityId === l.entityId);
      const seen = earlier.some(x => x.ip === l.ip && x.createdAt.getTime() >= l.createdAt.getTime() - 30 * 86400_000);
      if (earlier.length && !seen && !alerts.some(a => a.kind === 'newIp' && a.username === l.entityCode && a.ip === l.ip)) alerts.push({ kind: 'newIp', username: l.entityCode, ip: l.ip, at: l.createdAt });
    }
    return alerts.slice(0, 10);
  });
}
