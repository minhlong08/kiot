import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime, invoiceInputSchema, normalizeVi, buildVietQrPayload } from '@pd/shared';
import type { Prisma } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { linesWithInfo } from '../services/purchaseLines';
import { getSettings } from '../services/settings';
import { cancelInvoice, createInvoice } from '../services/sales';
import { docCtx, idOf } from './purchasing';
import { issueAutoDraft } from '../services/tax';

export const STATUS_LABELS: Record<string, string> = { processing: 'Đang xử lý', completed: 'Hoàn thành', undeliverable: 'Không giao được', cancelled: 'Đã hủy' };
const COST_KEYS = ['cost', 'costTotal'];
export const stripInvoiceCost = <T>(req: FastifyRequest, v: T): T => {
  if (hasPerm(req.user, 'cost.view')) return v;
  const strip = (o: unknown): unknown => Array.isArray(o) ? o.map(strip) : o && typeof o === 'object' && !(o instanceof Date)
    ? Object.fromEntries(Object.entries(o).filter(([k]) => !COST_KEYS.includes(k)).map(([k, x]) => [k, strip(x)])) : o;
  return strip(v) as T;
};

async function invoiceWhere(app: FastifyInstance, req: FastifyRequest): Promise<Prisma.InvoiceWhereInput> {
  const q = req.query as Record<string, unknown>;
  const from = dateParam(q.from), to = dateParam(q.to);
  const statuses = listParam(q.status);
  const methods = listParam(q.methods);
  const search = typeof q.search === 'string' ? q.search.trim() : '';
  const customerSearch = typeof q.customer === 'string' && q.customer.trim() ? normalizeVi(q.customer) : '';
  const customerIds = customerSearch ? (await app.prisma.customer.findMany({ where: { searchText: { contains: customerSearch } }, select: { id: true } })).map(c => c.id) : undefined;
  const returnState = q.returnState as string | undefined;
  return {
    branchId: user(req).branchId,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(q.delivery === 'true' ? { isDelivery: true } : q.delivery === 'false' ? { isDelivery: false } : {}),
    ...(listParam(q.channels) ? { channel: { in: listParam(q.channels)! } } : {}),
    ...(listParam(q.creators) ? { createdById: { in: listParam(q.creators)!.map(Number) } } : {}),
    ...(listParam(q.sellers) ? { sellerId: { in: listParam(q.sellers)!.map(Number) } } : {}),
    ...(q.customerId ? { customerId: Number(q.customerId) } : {}),
    ...(customerIds ? { customerId: { in: customerIds } } : {}),
    ...(methods ? { payments: { some: { method: { in: methods } } } } : {}),
    ...(returnState === 'none' ? { returnedTotal: 0 } : returnState === 'returned' ? { returnedTotal: { gt: 0 } } : {}),
    ...(search ? { code: { contains: search.toUpperCase() } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
}

export async function invoiceRoutes(app: FastifyInstance) {
  const db = app.prisma;

  async function decorate<T extends { id: number; customerId: number | null; sellerId: number; createdById: number }>(rows: T[]) {
    const [customers, users, returns] = await Promise.all([
      db.customer.findMany({ where: { id: { in: rows.map(r => r.customerId ?? 0) } }, select: { id: true, code: true, name: true, phone: true } }),
      db.user.findMany({ select: { id: true, fullName: true } }),
      db.saleReturn.findMany({ where: { invoiceId: { in: rows.map(r => r.id) }, status: 'completed' }, select: { invoiceId: true, code: true } }),
    ]);
    return rows.map(r => {
      const c = customers.find(x => x.id === r.customerId);
      return {
        ...r, customerCode: c?.code ?? '', customerName: c?.name ?? 'Khách lẻ', customerPhone: c?.phone ?? '',
        sellerName: users.find(u => u.id === r.sellerId)?.fullName ?? '', createdByName: users.find(u => u.id === r.createdById)?.fullName ?? '',
        returnCodes: returns.filter(x => x.invoiceId === r.id).map(x => x.code),
      };
    });
  }

  app.get('/api/invoices', { preHandler: requirePermission('invoices.view') }, async req => {
    const q = parseList(req.query);
    const where = await invoiceWhere(app, req);
    const [rows, total, sums] = await Promise.all([
      db.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }),
      db.invoice.count({ where }),
      db.invoice.aggregate({ where, _sum: { subtotal: true, promoDiscount: true, invoiceDiscount: true, voucherDiscount: true, total: true, paid: true, debt: true, costTotal: true } }),
    ]);
    const s = sums._sum;
    return stripInvoiceCost(req, {
      items: await decorate(rows), total,
      totals: { subtotal: s.subtotal ?? 0, discount: (s.promoDiscount ?? 0) + (s.invoiceDiscount ?? 0) + (s.voucherDiscount ?? 0), total: s.total ?? 0, paid: s.paid ?? 0, debt: s.debt ?? 0, costTotal: s.costTotal ?? 0 },
    });
  });

  app.get('/api/invoices/export', { preHandler: requirePermission('invoices.export') }, async (req, reply) => {
    const rows = await decorate(await db.invoice.findMany({ where: await invoiceWhere(app, req), orderBy: { createdAt: 'desc' }, take: 50_000 }));
    return sendXlsx(reply, 'hoa-don.xlsx', [
      { header: 'Mã hóa đơn', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Mã trả hàng', key: 'returns' }, { header: 'Mã KH', key: 'customerCode' },
      { header: 'Khách hàng', key: 'customerName', width: 26 }, { header: 'Tổng tiền hàng', key: 'subtotal', money: true }, { header: 'Giảm giá', key: 'discount', money: true },
      { header: 'Khách cần trả', key: 'total', money: true }, { header: 'Khách đã trả', key: 'paid', money: true }, { header: 'Còn nợ', key: 'debt', money: true },
      { header: 'Kênh bán', key: 'channel' }, { header: 'Người bán', key: 'sellerName' }, { header: 'Trạng thái', key: 'statusLabel' },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt), returns: r.returnCodes.join(', '), discount: r.promoDiscount + r.invoiceDiscount + r.voucherDiscount, statusLabel: STATUS_LABELS[r.status] ?? r.status })));
  });

  async function detail(req: FastifyRequest, id: number) {
    const inv = await db.invoice.findUnique({ where: { id }, include: { lines: true, payments: true } });
    if (!inv || inv.branchId !== user(req).branchId) throw notFound('Hóa đơn');
    const [decorated] = await decorate([inv]);
    const [lines, vouchers, delivery, returns, history, funds] = await Promise.all([
      linesWithInfo(db, inv.lines),
      db.cashVoucher.findMany({ where: { id: { in: inv.payments.map(p => p.cashVoucherId ?? 0) } }, select: { id: true, code: true, status: true } }),
      db.invoiceDelivery.findUnique({ where: { invoiceId: id } }),
      db.saleReturn.findMany({ where: { invoiceId: id }, select: { id: true, code: true, status: true, total: true, createdAt: true } }),
      db.auditLog.findMany({ where: { entity: 'Invoice', entityId: String(id) }, orderBy: { id: 'asc' } }),
      db.cashFund.findMany({ select: { id: true, name: true } }),
    ]);
    return stripInvoiceCost(req, {
      ...decorated, promotions: JSON.parse(inv.promotions), lines, delivery, returns, history,
      payments: inv.payments.map(p => ({ ...p, voucherCode: vouchers.find(v => v.id === p.cashVoucherId)?.code ?? null, fundName: funds.find(f => f.id === p.fundId)?.name ?? '' })),
    });
  }

  app.get('/api/invoices/:id', { preHandler: requirePermission('invoices.view') }, async req => detail(req, idOf(req)));

  app.post('/api/invoices', { preHandler: requirePermission('invoices.create', 'pos.access') }, async req => {
    const input = invoiceInputSchema.parse(req.body);
    try {
      const inv = await db.$transaction(tx => createInvoice(tx, docCtx(req), input, user(req)), { timeout: 30_000 });
      await issueAutoDraft(db, docCtx(req), inv.id);
      return detail(req, inv.id);
    } catch (e) {
      // Two replays of one offline sale racing: the loser returns the winner's invoice.
      const existing = input.clientUuid && (e as { code?: string }).code === 'P2002' ? await db.invoice.findUnique({ where: { clientUuid: input.clientUuid } }) : null;
      if (existing) return detail(req, existing.id);
      throw e;
    }
  });

  app.post('/api/invoices/:id/cancel', { preHandler: requirePermission('invoices.delete') }, async req => {
    await db.$transaction(tx => cancelInvoice(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });

  app.get('/api/invoices/:id/copy', { preHandler: requirePermission('invoices.create', 'pos.access') }, async req => {
    const d = await detail(req, idOf(req));
    return { customerId: d.customerId, priceBookId: d.priceBookId, channel: d.channel, note: d.note, lines: d.lines.filter(l => !l.isGift).map(l => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, price: l.price, discount: l.discount, note: l.note, productCode: l.productCode, productName: l.productName, unit: l.unit })) };
  });

  app.get('/api/invoices/:id/print', { preHandler: requirePermission('invoices.view', 'pos.access') }, async req => {
    const d = await detail(req, idOf(req));
    const settings = await getSettings(db);
    const qr = settings.pos.bankQr;
    const unpaid = d.total - d.pointsValue - d.paid;
    return {
      ...d, store: settings.store,
      qrPayload: qr.bankBin && qr.accountNumber && unpaid > 0 ? buildVietQrPayload({ bankBin: qr.bankBin, accountNumber: qr.accountNumber, amount: unpaid, description: d.code }) : null,
    };
  });

  // Customer purchase history (invoices + returns) for the customer detail screen.
  app.get('/api/customers/:id/history', { preHandler: requirePermission('customers.view') }, async req => {
    const id = idOf(req);
    const [invoices, returns] = await Promise.all([
      db.invoice.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.saleReturn.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const users = await db.user.findMany({ select: { id: true, fullName: true } });
    return [
      ...invoices.map(i => ({ type: 'invoice', id: i.id, code: i.code, createdAt: i.createdAt, total: i.total, status: i.status, sellerName: users.find(u => u.id === i.sellerId)?.fullName ?? '' })),
      ...returns.map(r => ({ type: 'return', id: r.id, code: r.code, createdAt: r.createdAt, total: -r.total, status: r.status, sellerName: users.find(u => u.id === r.createdById)?.fullName ?? '' })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });
}
