import type { FastifyInstance } from 'fastify';
import { dateParam } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { REPORTS, stripCost, type Report } from '../reports/types';
import '../reports/sales';
import '../reports/products';
import '../reports/finance';

const fmtDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

export async function reportRoutes(app: FastifyInstance) {
  const db = app.prisma;
  async function build(req: Parameters<typeof user>[0] & { params: unknown; query: unknown }): Promise<Report> {
    const name = (req.params as { name: string }).name;
    const builder = REPORTS.get(name);
    if (!builder) throw notFound('Báo cáo');
    const q = req.query as Record<string, unknown>;
    const u = user(req);
    const now = new Date();
    const from = dateParam(q.from) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 7 * 3600_000);
    const to = dateParam(q.to) ?? now;
    // Admins: all branches or any one; others: a branch they have access to, else their session branch.
    const asked = Number(q.branchId);
    const allowed = Number.isInteger(asked) && asked > 0 && (u.isAdmin || !!(await db.userBranch.findFirst({ where: { userId: u.id, branchId: asked } })));
    const branchId = q.branchId === 'all' && u.isAdmin ? null : allowed ? asked : u.branchId;
    return stripCost(await builder({ db, user: u, from, to, branchId, q }), hasPerm(u, 'cost.view'));
  }
  app.get('/api/reports/:name', { preHandler: requirePermission('reports.view') }, async req => build(req));
  app.get('/api/reports/:name/export', { preHandler: requirePermission('reports.export') }, async (req, reply) => {
    const r = await build(req);
    const rows = r.rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? fmtDate(v) : v])));
    const first = r.columns[0]?.key;
    if (rows.length && first) rows.push({ ...r.totals, [first]: 'Tổng cộng' });
    return sendXlsx(reply, `${(req.params as { name: string }).name}.xlsx`, r.columns.map(c => ({ header: c.label, key: c.key })), rows);
  });
}
