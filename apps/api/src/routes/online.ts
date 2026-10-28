import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { cancelOrder, confirmOrder } from '../services/customerOrders';
import { docCtx, idOf } from './purchasing';

const channelInput = z.object({ code: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/, 'Mã kênh gồm chữ thường, số, -'), name: z.string().trim().min(1).max(80), isActive: z.boolean().default(true) });

export async function onlineRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/sales-channels', async () => db.salesChannel.findMany({ orderBy: { id: 'asc' } }));
  app.post('/api/sales-channels', { preHandler: requirePermission('online.create', 'online.edit') }, async req => {
    const data = channelInput.parse(req.body);
    if (await db.salesChannel.findFirst({ where: { OR: [{ code: data.code }, { name: data.name }] } })) throw conflict('DUPLICATE', 'Mã hoặc tên kênh đã tồn tại');
    return db.$transaction(async tx => {
      const c = await tx.salesChannel.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'SalesChannel', entityId: c.id, entityCode: c.code, summary: `Tạo kênh bán ${c.name}` });
      return c;
    });
  });
  app.put('/api/sales-channels/:id', { preHandler: requirePermission('online.edit') }, async req => {
    const data = channelInput.omit({ code: true }).parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.salesChannel.findUnique({ where: { id: idOf(req) } });
      if (!before) throw notFound('Kênh bán');
      if (before.code === 'store' && !data.isActive) throw conflict('SYSTEM_CHANNEL', 'Không thể ngừng kênh Cửa hàng');
      const c = await tx.salesChannel.update({ where: { id: before.id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'SalesChannel', entityId: c.id, entityCode: c.code, summary: `Sửa kênh bán ${c.name}` });
      return c;
    });
  });
  app.delete('/api/sales-channels/:id', { preHandler: requirePermission('online.delete') }, async req =>
    db.$transaction(async tx => {
      const c = await tx.salesChannel.findUnique({ where: { id: idOf(req) } });
      if (!c) throw notFound('Kênh bán');
      const used = (await tx.invoice.count({ where: { channel: c.code } })) + (await tx.customerOrder.count({ where: { channel: c.code } }));
      if (used || ['store', 'website'].includes(c.code)) {
        await tx.salesChannel.update({ where: { id: c.id }, data: { isActive: c.code === 'store' } });
        return { deactivated: true };
      }
      await tx.salesChannel.delete({ where: { id: c.id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'SalesChannel', entityId: c.id, entityCode: c.code, summary: `Xóa kênh bán ${c.name}` });
      return { deleted: true };
    }));

  /** Inbox: customer orders from every channel except the shop counter. */
  app.get('/api/online-orders', { preHandler: requirePermission('online.view', 'customerOrders.view') }, async req => {
    const q = parseList(req.query);
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const where: Prisma.CustomerOrderWhereInput = {
      branchId: user(req).branchId, channel: listParam(raw.channels) ? { in: listParam(raw.channels) } : { not: 'store' },
      ...(listParam(raw.status) ? { status: { in: listParam(raw.status) } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search } }, { note: { contains: q.search } }] } : {}),
    };
    const [rows, total, counts] = await Promise.all([
      db.customerOrder.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take, include: { lines: true } }),
      db.customerOrder.count({ where }),
      db.customerOrder.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    const [customers, products, channels] = await Promise.all([
      db.customer.findMany({ where: { id: { in: rows.map(r => r.customerId).filter((x): x is number => !!x) } }, select: { id: true, code: true, name: true, phone: true } }),
      db.product.findMany({ where: { id: { in: rows.flatMap(r => r.lines.map(l => l.productId)) } }, select: { id: true, code: true, name: true } }),
      db.salesChannel.findMany(),
    ]);
    return {
      total, statusCounts: Object.fromEntries(counts.map(c => [c.status, c._count._all])),
      items: rows.map(({ lines, ...r }) => ({
        ...r, customer: customers.find(c => c.id === r.customerId) ?? null, channelName: channels.find(c => c.code === r.channel)?.name ?? r.channel,
        lines: lines.map(l => ({ ...l, productCode: products.find(p => p.id === l.productId)?.code, productName: products.find(p => p.id === l.productId)?.name })),
      })),
    };
  });
  app.post('/api/customer-orders/:id/accept', { preHandler: requirePermission('customerOrders.edit', 'online.edit') }, async req => {
    const o = await db.customerOrder.findUnique({ where: { id: idOf(req) } });
    if (!o || o.branchId !== user(req).branchId) throw notFound('Đơn đặt hàng');
    if (o.status !== 'pending') throw conflict('NOT_PENDING', 'Đơn không ở trạng thái chờ xác nhận');
    await db.$transaction(tx => confirmOrder(tx, docCtx(req), o.id));
    return { ok: true };
  });
  app.post('/api/customer-orders/:id/reject', { preHandler: requirePermission('customerOrders.delete', 'online.edit') }, async req => {
    const o = await db.customerOrder.findUnique({ where: { id: idOf(req) } });
    if (!o || o.branchId !== user(req).branchId) throw notFound('Đơn đặt hàng');
    if (o.status !== 'pending') throw conflict('NOT_PENDING', 'Đơn không ở trạng thái chờ xác nhận');
    await db.$transaction(tx => cancelOrder(tx, docCtx(req), o.id));
    return { ok: true };
  });
}
