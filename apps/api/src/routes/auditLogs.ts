import type { FastifyInstance } from 'fastify';
import { formatDateTime } from '@pd/shared';
import type { Prisma } from '../generated/prisma/client';
import { requirePermission } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';

function whereOf(query: Record<string, unknown>, search?: string): Prisma.AuditLogWhereInput {
  const from = dateParam(query.from), to = dateParam(query.to);
  const entities = listParam(query.entity), actions = listParam(query.action);
  return {
    ...(entities ? { entity: { in: entities } } : {}),
    ...(actions ? { action: { in: actions } } : {}),
    ...(query.userId ? { userId: Number(query.userId) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(search ? { OR: [{ summary: { contains: search } }, { entityCode: { contains: search } }] } : {}),
  };
}

export async function auditLogRoutes(app: FastifyInstance) {
  const db = app.prisma;

  async function withUsers<T extends { userId: number | null }>(rows: T[]) {
    const ids = [...new Set(rows.map(r => r.userId).filter((v): v is number => v !== null))];
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const name = new Map(users.map(u => [u.id, u.fullName]));
    return rows.map(r => ({ ...r, userName: r.userId ? name.get(r.userId) ?? '' : '' }));
  }

  app.get('/api/audit-logs', { preHandler: requirePermission('settings.view') }, async req => {
    const q = parseList(req.query);
    const where = whereOf(req.query as Record<string, unknown>, q.search?.trim());
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }),
      db.auditLog.count({ where }),
    ]);
    return { items: await withUsers(rows), total };
  });

  app.get('/api/audit-logs/entities', { preHandler: requirePermission('settings.view') }, async () => {
    const rows = await db.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } });
    return rows.map(r => r.entity);
  });

  app.get('/api/audit-logs/export', { preHandler: requirePermission('settings.export', 'settings.view') }, async (req, reply) => {
    const q = parseList(req.query);
    const rows = await withUsers(await db.auditLog.findMany({ where: whereOf(req.query as Record<string, unknown>, q.search?.trim()), orderBy: { id: 'desc' }, take: 50_000 }));
    return sendXlsx(reply, 'lich-su-thao-tac.xlsx', [
      { header: 'Thời gian', key: 'time', width: 18 },
      { header: 'Người thực hiện', key: 'userName', width: 22 },
      { header: 'Chức năng', key: 'entity' },
      { header: 'Thao tác', key: 'action' },
      { header: 'Mã', key: 'entityCode' },
      { header: 'Nội dung', key: 'summary', width: 50 },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt) })));
  });
}
