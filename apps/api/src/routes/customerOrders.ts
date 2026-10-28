import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { formatDateTime, moneySchema } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { linesWithInfo } from '../services/purchaseLines';
import { addDeposit, cancelOrder, confirmOrder, orderInputSchema, saveOrder } from '../services/customerOrders';
import { docCtx, idOf } from './purchasing';

export async function customerOrderRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const where = (req: FastifyRequest): Prisma.CustomerOrderWhereInput => {
    const q = req.query as Record<string, unknown>;
    const from = dateParam(q.from), to = dateParam(q.to);
    return {
      branchId: user(req).branchId,
      ...(listParam(q.status) ? { status: { in: listParam(q.status)! } } : {}),
      ...(listParam(q.channels) ? { channel: { in: listParam(q.channels)! } } : {}),
      ...(q.customerId ? { customerId: Number(q.customerId) } : {}),
      ...(typeof q.search === 'string' && q.search.trim() ? { code: { contains: q.search.trim().toUpperCase() } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
  };
  async function decorate<T extends { customerId: number | null }>(rows: T[]) {
    const customers = await db.customer.findMany({ where: { id: { in: rows.map(r => r.customerId ?? 0) } }, select: { id: true, code: true, name: true, phone: true } });
    return rows.map(r => ({ ...r, customerCode: customers.find(c => c.id === r.customerId)?.code ?? '', customerName: customers.find(c => c.id === r.customerId)?.name ?? 'Khách lẻ' }));
  }
  async function detail(req: FastifyRequest, id: number) {
    const o = await db.customerOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!o || o.branchId !== user(req).branchId) throw notFound('Đơn đặt hàng');
    const [d] = await decorate([o]);
    const invoices = await db.invoice.findMany({ where: { orderId: id }, select: { id: true, code: true, status: true, total: true, createdAt: true } });
    return { ...d, lines: (await linesWithInfo(db, o.lines)).map(l => ({ ...l, remainingQty: Math.max(0, l.qty - l.deliveredQty) })), invoices };
  }

  app.get('/api/customer-orders', { preHandler: requirePermission('customerOrders.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([db.customerOrder.findMany({ where: w, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }), db.customerOrder.count({ where: w }), db.customerOrder.aggregate({ where: w, _sum: { total: true, deposit: true } })]);
    return { items: await decorate(rows), total, totals: { total: sums._sum.total ?? 0, deposit: sums._sum.deposit ?? 0 } };
  });
  app.get('/api/customer-orders/export', { preHandler: requirePermission('customerOrders.export') }, async (req, reply) => {
    const rows = await decorate(await db.customerOrder.findMany({ where: where(req), orderBy: { createdAt: 'desc' } }));
    return sendXlsx(reply, 'dat-hang.xlsx', [
      { header: 'Mã đặt hàng', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Khách hàng', key: 'customerName', width: 26 },
      { header: 'Tổng cộng', key: 'total', money: true }, { header: 'Đã cọc', key: 'deposit', money: true }, { header: 'Trạng thái', key: 'status' },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt) })));
  });
  app.get('/api/customer-orders/:id', { preHandler: requirePermission('customerOrders.view') }, async req => detail(req, idOf(req)));
  app.get('/api/customer-orders/:id/invoice-draft', { preHandler: requirePermission('invoices.create', 'pos.access') }, async req => {
    const o = await detail(req, idOf(req));
    return {
      orderId: o.id, orderCode: o.code, customerId: o.customerId, depositAvailable: o.deposit - o.depositUsed,
      lines: o.lines.filter(l => l.remainingQty > 0).map(l => ({ productId: l.productId, unitId: l.unitId, qty: l.remainingQty, price: l.price, discount: Math.round((l.discount * l.remainingQty) / l.qty), productCode: l.productCode, productName: l.productName, unit: l.unit })),
    };
  });
  app.post('/api/customer-orders', { preHandler: requirePermission('customerOrders.create') }, async req => {
    const b = orderInputSchema.parse(req.body);
    const id = await db.$transaction(async tx => {
      const o = await saveOrder(tx, docCtx(req), b);
      if (b.confirm) await confirmOrder(tx, docCtx(req), o.id);
      return o.id;
    });
    return detail(req, id);
  });
  app.put('/api/customer-orders/:id', { preHandler: requirePermission('customerOrders.edit') }, async req => {
    const b = orderInputSchema.parse(req.body);
    await db.$transaction(async tx => {
      await saveOrder(tx, docCtx(req), b, idOf(req));
      if (b.confirm) await confirmOrder(tx, docCtx(req), idOf(req));
    });
    return detail(req, idOf(req));
  });
  app.post('/api/customer-orders/:id/confirm', { preHandler: requirePermission('customerOrders.edit', 'customerOrders.create') }, async req => {
    await db.$transaction(tx => confirmOrder(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
  app.post('/api/customer-orders/:id/deposit', { preHandler: requirePermission('customerOrders.edit') }, async req => {
    const { amount, fundId } = z.object({ amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'), fundId: z.number().int().nullable().default(null) }).parse(req.body);
    await detail(req, idOf(req));
    await db.$transaction(tx => addDeposit(tx, docCtx(req), idOf(req), amount, fundId));
    return detail(req, idOf(req));
  });
  app.post('/api/customer-orders/:id/cancel', { preHandler: requirePermission('customerOrders.delete') }, async req => {
    await db.$transaction(tx => cancelOrder(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
}
