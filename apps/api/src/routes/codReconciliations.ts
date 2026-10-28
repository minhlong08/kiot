import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { dateParam, parseList } from '../lib/list';
import { AppError } from '../lib/errors';
import { cancelCodReconciliation, reconcileCod } from '../services/codReconciliation';
import { docCtx, idOf } from './purchasing';

const input = z.object({ partnerId: z.number().int(), invoiceIds: z.array(z.number().int()).min(1).max(500), fundId: z.number().int().nullable().default(null), note: z.string().max(500).default('') });
const needCash = (req: Parameters<typeof user>[0]) => { if (!hasPerm(user(req), 'cashbook.create')) throw new AppError(403, 'FORBIDDEN', 'Cần quyền lập phiếu thu chi'); };

export async function codReconciliationRoutes(app: FastifyInstance) {
  const db = app.prisma;
  app.get('/api/cod-reconciliations', { preHandler: requirePermission('deliveries.view') }, async req => {
    const q = parseList(req.query);
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const where: Prisma.CodReconciliationWhereInput = {
      branchId: user(req).branchId, ...(raw.partnerId ? { partnerId: Number(raw.partnerId) } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([db.codReconciliation.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.codReconciliation.count({ where })]);
    const partners = await db.deliveryPartner.findMany({ where: { id: { in: rows.map(r => r.partnerId) } }, select: { id: true, name: true } });
    const counts = await db.invoiceDelivery.groupBy({ by: ['reconciliationId'], where: { reconciliationId: { in: rows.map(r => r.id) } }, _count: { _all: true } });
    return { items: rows.map(r => ({ ...r, partnerName: partners.find(p => p.id === r.partnerId)?.name ?? '', waybillCount: counts.find(c => c.reconciliationId === r.id)?._count._all ?? 0 })), total };
  });
  app.post('/api/cod-reconciliations', { preHandler: requirePermission('deliveries.edit') }, async req => {
    needCash(req);
    const b = input.parse(req.body);
    return db.$transaction(tx => reconcileCod(tx, docCtx(req), b));
  });
  app.post('/api/cod-reconciliations/:id/cancel', { preHandler: requirePermission('deliveries.edit') }, async req => {
    needCash(req);
    await db.$transaction(tx => cancelCodReconciliation(tx, docCtx(req), idOf(req)));
    return { ok: true };
  });
}
