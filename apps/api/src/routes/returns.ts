import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { linesWithInfo } from '../services/purchaseLines';
import { cancelReturn, createReturn, returnDraft, returnInputSchema } from '../services/returns';
import { stripInvoiceCost } from './invoices';
import { docCtx, idOf } from './purchasing';

export async function returnRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const where = (req: FastifyRequest): Prisma.SaleReturnWhereInput => {
    const q = req.query as Record<string, unknown>;
    const from = dateParam(q.from), to = dateParam(q.to);
    return {
      branchId: user(req).branchId,
      ...(listParam(q.status) ? { status: { in: listParam(q.status)! } } : {}),
      ...(typeof q.search === 'string' && q.search.trim() ? { code: { contains: q.search.trim().toUpperCase() } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
  };
  async function decorate<T extends { customerId: number | null; invoiceId: number | null; createdById: number }>(rows: T[]) {
    const [customers, invoices, users] = await Promise.all([
      db.customer.findMany({ where: { id: { in: rows.map(r => r.customerId ?? 0) } }, select: { id: true, code: true, name: true } }),
      db.invoice.findMany({ where: { id: { in: rows.map(r => r.invoiceId ?? 0) } }, select: { id: true, code: true } }),
      db.user.findMany({ select: { id: true, fullName: true } }),
    ]);
    return rows.map(r => ({ ...r, customerName: customers.find(c => c.id === r.customerId)?.name ?? 'Khách lẻ', customerCode: customers.find(c => c.id === r.customerId)?.code ?? '', invoiceCode: invoices.find(i => i.id === r.invoiceId)?.code ?? '', createdByName: users.find(u => u.id === r.createdById)?.fullName ?? '' }));
  }
  async function detail(req: FastifyRequest, id: number) {
    const r = await db.saleReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!r || r.branchId !== user(req).branchId) throw notFound('Phiếu trả hàng');
    const [d] = await decorate([r]);
    const exchange = r.exchangeInvoiceId ? await db.invoice.findUnique({ where: { id: r.exchangeInvoiceId } }) : null;
    return stripInvoiceCost(req, { ...d, lines: await linesWithInfo(db, r.lines), exchangeInvoice: exchange });
  }

  app.get('/api/invoices/:id/return-draft', { preHandler: requirePermission('returns.create') }, async req => returnDraft(db, idOf(req), user(req).branchId));
  app.get('/api/returns', { preHandler: requirePermission('returns.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([db.saleReturn.findMany({ where: w, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }), db.saleReturn.count({ where: w }), db.saleReturn.aggregate({ where: w, _sum: { subtotal: true, returnFee: true, total: true, refunded: true } })]);
    return stripInvoiceCost(req, { items: await decorate(rows), total, totals: { subtotal: sums._sum.subtotal ?? 0, returnFee: sums._sum.returnFee ?? 0, total: sums._sum.total ?? 0, refunded: sums._sum.refunded ?? 0 } });
  });
  app.get('/api/returns/export', { preHandler: requirePermission('returns.export') }, async (req, reply) => {
    const rows = await decorate(await db.saleReturn.findMany({ where: where(req), orderBy: { createdAt: 'desc' } }));
    return sendXlsx(reply, 'tra-hang.xlsx', [
      { header: 'Mã trả hàng', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Hóa đơn', key: 'invoiceCode' }, { header: 'Khách hàng', key: 'customerName', width: 26 },
      { header: 'Tổng tiền hàng trả', key: 'subtotal', money: true }, { header: 'Phí trả hàng', key: 'returnFee', money: true }, { header: 'Cần trả khách', key: 'total', money: true },
      { header: 'Đã trả khách', key: 'refunded', money: true }, { header: 'Trạng thái', key: 'status' },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt) })));
  });
  app.get('/api/returns/:id', { preHandler: requirePermission('returns.view') }, async req => detail(req, idOf(req)));
  app.post('/api/returns', { preHandler: requirePermission('returns.create') }, async req => {
    const input = returnInputSchema.parse(req.body);
    const r = await db.$transaction(tx => createReturn(tx, docCtx(req), input, user(req)), { timeout: 30_000 });
    return detail(req, r.id);
  });
  app.post('/api/returns/:id/cancel', { preHandler: requirePermission('returns.delete') }, async req => {
    await db.$transaction(tx => cancelReturn(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
}
