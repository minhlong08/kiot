import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { deliveryInputSchema, normalizeVi } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { AppError, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { DELIVERY_STATUS_LABELS, EDITABLE, setDeliveryStatus } from '../services/delivery';
import { docCtx, idOf } from './purchasing';

const STATUSES = Object.keys(DELIVERY_STATUS_LABELS);
const editInput = deliveryInputSchema.extend({ feePayer: z.enum(['shop', 'customer']).default('shop'), trackingCode: z.string().max(60).default('') }).omit({ cod: true });

export async function deliveryRoutes(app: FastifyInstance) {
  const db = app.prisma;

  async function where(req: { query: unknown; user?: unknown } & Parameters<typeof user>[0]): Promise<Prisma.InvoiceDeliveryWhereInput> {
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const search = typeof raw.search === 'string' && raw.search.trim() ? raw.search.trim() : undefined;
    const invoices = await db.invoice.findMany({
      where: { branchId: user(req).branchId, isDelivery: true, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) },
      select: { id: true, code: true },
    });
    const ids = invoices.map(i => i.id);
    const codeHits = search ? invoices.filter(i => i.code.toLowerCase().includes(search.toLowerCase())).map(i => i.id) : [];
    const reconciled = raw.reconciled === 'true' ? { reconciledAt: { not: null } } : raw.reconciled === 'false' ? { reconciledAt: null } : {};
    return {
      invoiceId: { in: ids },
      ...(listParam(raw.status) ? { status: { in: listParam(raw.status) } } : {}),
      ...(listParam(raw.partnerIds) ? { partnerId: { in: listParam(raw.partnerIds)!.map(Number) } } : {}),
      ...(raw.selfDelivery === 'true' ? { partnerId: null } : {}),
      ...(typeof raw.province === 'string' && raw.province ? { province: raw.province } : {}),
      ...reconciled,
      ...(search ? { OR: [{ invoiceId: { in: codeHits } }, { receiverName: { contains: search } }, { receiverPhone: { contains: search } }, { trackingCode: { contains: search } }] } : {}),
    };
  }
  async function decorate(rows: Awaited<ReturnType<typeof db.invoiceDelivery.findMany>>) {
    const [invoices, partners] = await Promise.all([
      db.invoice.findMany({ where: { id: { in: rows.map(r => r.invoiceId) } }, select: { id: true, code: true, createdAt: true, total: true, paid: true, status: true, customerId: true } }),
      db.deliveryPartner.findMany({ where: { id: { in: rows.map(r => r.partnerId).filter((x): x is number => !!x) } }, select: { id: true, name: true, code: true } }),
    ]);
    const customers = await db.customer.findMany({ where: { id: { in: invoices.map(i => i.customerId).filter((x): x is number => !!x) } }, select: { id: true, code: true, name: true } });
    return rows.map(r => {
      const inv = invoices.find(i => i.id === r.invoiceId)!;
      const c = customers.find(x => x.id === inv?.customerId);
      return {
        ...r, invoiceCode: inv?.code, createdAt: inv?.createdAt, invoiceTotal: inv?.total, invoicePaid: inv?.paid, invoiceStatus: inv?.status,
        customerName: c?.name ?? 'Khách lẻ', customerCode: c?.code ?? null, partnerName: partners.find(p => p.id === r.partnerId)?.name ?? 'Tự giao', statusLabel: DELIVERY_STATUS_LABELS[r.status],
      };
    });
  }

  app.get('/api/deliveries', { preHandler: requirePermission('deliveries.view') }, async req => {
    const q = parseList(req.query);
    const w = await where(req);
    const [rows, total, sums, counts] = await Promise.all([
      db.invoiceDelivery.findMany({ where: w, orderBy: { invoiceId: 'desc' }, skip: q.skip, take: q.take }),
      db.invoiceDelivery.count({ where: w }),
      db.invoiceDelivery.aggregate({ where: w, _sum: { cod: true, fee: true } }),
      db.invoiceDelivery.groupBy({ by: ['status'], where: { ...w, status: undefined }, _count: { _all: true } }),
    ]);
    return {
      items: await decorate(rows), total, totals: { cod: sums._sum.cod ?? 0, fee: sums._sum.fee ?? 0 },
      statusCounts: Object.fromEntries(STATUSES.map(s => [s, counts.find(c => c.status === s)?._count._all ?? 0])),
    };
  });
  app.get('/api/deliveries/export', { preHandler: requirePermission('deliveries.export') }, async (req, reply) => {
    const rows = await decorate(await db.invoiceDelivery.findMany({ where: await where(req), orderBy: { invoiceId: 'asc' } }));
    return sendXlsx(reply, 'van-don.xlsx', [
      { header: 'Mã vận đơn', key: 'invoiceCode' }, { header: 'Người nhận', key: 'receiverName' }, { header: 'Điện thoại', key: 'receiverPhone' },
      { header: 'Địa chỉ', key: 'address' }, { header: 'Tỉnh/Thành', key: 'province' }, { header: 'Đối tác', key: 'partnerName' },
      { header: 'Phí giao', key: 'fee' }, { header: 'COD', key: 'cod' }, { header: 'Trạng thái', key: 'statusLabel' },
    ], rows);
  });
  const find = async (req: Parameters<typeof user>[0] & { params: unknown }) => {
    const id = Number((req.params as { invoiceId: string }).invoiceId);
    const d = await db.invoiceDelivery.findUnique({ where: { invoiceId: id } });
    const inv = d && await db.invoice.findUnique({ where: { id }, select: { branchId: true } });
    if (!d || inv?.branchId !== user(req).branchId) throw notFound('Vận đơn');
    return d;
  };
  app.get('/api/deliveries/:invoiceId', { preHandler: requirePermission('deliveries.view', 'invoices.view') }, async req => (await decorate([await find(req)]))[0]);
  app.put('/api/deliveries/:invoiceId', { preHandler: requirePermission('deliveries.edit') }, async req => {
    const data = editInput.parse(req.body);
    const d = await find(req);
    return db.$transaction(async tx => {
      const r = await tx.invoiceDelivery.updateMany({ where: { invoiceId: d.invoiceId, status: { in: EDITABLE } }, data: { ...data, updatedAt: new Date() } });
      if (!r.count) throw conflict('DELIVERY_LOCKED', 'Hàng đã giao cho đối tác, không sửa được vận đơn');
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Delivery', entityId: d.invoiceId, entityCode: String(d.invoiceId), summary: 'Sửa thông tin vận đơn', before: d });
      return tx.invoiceDelivery.findUniqueOrThrow({ where: { invoiceId: d.invoiceId } });
    });
  });
  const statusInput = z.object({ to: z.enum(STATUSES as [string, ...string[]]), note: z.string().max(300).default('') });
  app.post('/api/deliveries/:invoiceId/status', { preHandler: requirePermission('deliveries.edit') }, async req => {
    const b = statusInput.parse(req.body);
    const d = await find(req);
    return db.$transaction(tx => setDeliveryStatus(tx, docCtx(req), d.invoiceId, b.to, { note: b.note }));
  });
  app.post('/api/deliveries/bulk-status', { preHandler: requirePermission('deliveries.edit') }, async req => {
    const b = statusInput.extend({ invoiceIds: z.array(z.number().int()).min(1).max(200) }).parse(req.body);
    const results: { invoiceId: number; ok: boolean; error?: string }[] = [];
    for (const id of b.invoiceIds) {
      try {
        await db.$transaction(tx => setDeliveryStatus(tx, docCtx(req), id, b.to, { note: b.note }));
        results.push({ invoiceId: id, ok: true });
      } catch (e) {
        results.push({ invoiceId: id, ok: false, error: e instanceof AppError ? e.message : 'Lỗi không xác định' });
      }
    }
    return { results };
  });
}
