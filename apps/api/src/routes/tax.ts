import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { cancelEInvoice, createEInvoiceDraft, issueEInvoice, taxDeclaration } from '../services/tax';
import { docCtx, idOf } from './purchasing';

const STATUS_LABELS: Record<string, string> = { draft: 'Nháp', issued: 'Đã phát hành', cancelled: 'Đã hủy', deleted: 'Đã xóa' };
const draftInput = z.object({ invoiceId: z.number().int(), buyerName: z.string().max(200).optional(), buyerTaxCode: z.string().max(20).optional(), buyerAddress: z.string().max(300).optional(), buyerEmail: z.string().max(120).optional() });
const periodInput = z.object({ year: z.coerce.number().int().min(2000).max(2100), quarter: z.coerce.number().int().min(1).max(4) });

export async function taxRoutes(app: FastifyInstance) {
  const db = app.prisma;

  async function decorate(rows: Awaited<ReturnType<typeof db.eInvoice.findMany>>) {
    const invoices = await db.invoice.findMany({ where: { id: { in: rows.map(r => r.invoiceId) } }, select: { id: true, code: true, createdAt: true } });
    return rows.map(r => ({ ...r, invoiceCode: invoices.find(i => i.id === r.invoiceId)?.code ?? '', invoiceDate: invoices.find(i => i.id === r.invoiceId)?.createdAt, statusLabel: STATUS_LABELS[r.status] ?? r.status, rates: JSON.parse(r.ratesJson) }));
  }
  app.get('/api/e-invoices', { preHandler: requirePermission('tax.view') }, async req => {
    const q = parseList(req.query);
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const search = q.search?.trim();
    const codeHits = search ? (await db.invoice.findMany({ where: { code: { contains: search } }, select: { id: true } })).map(i => i.id) : [];
    const where: Prisma.EInvoiceWhereInput = {
      branchId: user(req).branchId, status: { in: listParam(raw.status) ?? ['draft', 'issued', 'cancelled'] },
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(search ? { OR: [{ number: { contains: search } }, { buyerName: { contains: search } }, { buyerTaxCode: { contains: search } }, { invoiceId: { in: codeHits } }] } : {}),
    };
    const [rows, total, sums] = await Promise.all([
      db.eInvoice.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.eInvoice.count({ where }),
      db.eInvoice.aggregate({ where, _sum: { total: true, vatAmount: true, totalBeforeVat: true } }),
    ]);
    return { items: await decorate(rows), total, totals: { total: sums._sum.total ?? 0, vatAmount: sums._sum.vatAmount ?? 0, totalBeforeVat: sums._sum.totalBeforeVat ?? 0 } };
  });
  const owned = async (req: Parameters<typeof user>[0] & { params: unknown }) => {
    const e = await db.eInvoice.findUnique({ where: { id: idOf(req as never) } });
    if (!e || e.branchId !== user(req).branchId) throw notFound('Hóa đơn điện tử');
    return e;
  };
  app.get('/api/e-invoices/:id/print', { preHandler: requirePermission('tax.view') }, async req => {
    const e = (await decorate([await owned(req)]))[0];
    const lines = await db.invoiceLine.findMany({ where: { invoiceId: e.invoiceId }, orderBy: { id: 'asc' } });
    const products = await db.product.findMany({ where: { id: { in: lines.map(l => l.productId) } }, select: { id: true, code: true, name: true, unit: true } });
    const s = await getSettings(db);
    return { ...e, store: s.store, lines: lines.map(l => ({ ...l, productCode: products.find(p => p.id === l.productId)?.code, productName: products.find(p => p.id === l.productId)?.name, unit: products.find(p => p.id === l.productId)?.unit ?? '' })) };
  });
  app.post('/api/e-invoices', { preHandler: requirePermission('tax.create') }, async req => {
    const b = draftInput.parse(req.body);
    return db.$transaction(tx => createEInvoiceDraft(tx, docCtx(req), b));
  });
  app.put('/api/e-invoices/:id', { preHandler: requirePermission('tax.edit') }, async req => {
    const b = draftInput.omit({ invoiceId: true }).parse(req.body);
    const e = await owned(req);
    const r = await db.eInvoice.updateMany({ where: { id: e.id, status: 'draft' }, data: b });
    if (!r.count) throw conflict('NOT_DRAFT', 'Chỉ sửa được hóa đơn nháp');
    return db.eInvoice.findUniqueOrThrow({ where: { id: e.id } });
  });
  app.post('/api/e-invoices/:id/issue', { preHandler: requirePermission('tax.edit', 'tax.create') }, async req => {
    const e = await owned(req);
    return db.$transaction(tx => issueEInvoice(tx, docCtx(req), e.id));
  });
  app.post('/api/e-invoices/:id/cancel', { preHandler: requirePermission('tax.delete') }, async req => {
    const { reason } = z.object({ reason: z.string().trim().min(1, 'Nhập lý do hủy').max(300) }).parse(req.body);
    const e = await owned(req);
    return db.$transaction(tx => cancelEInvoice(tx, docCtx(req), e.id, reason));
  });
  app.delete('/api/e-invoices/:id', { preHandler: requirePermission('tax.delete') }, async req => {
    const e = await owned(req);
    const r = await db.eInvoice.updateMany({ where: { id: e.id, status: 'draft' }, data: { status: 'deleted' } });
    if (!r.count) throw conflict('NOT_DRAFT', 'Chỉ xóa được hóa đơn nháp');
    await audit(db, req.auditCtx, { action: 'delete', entity: 'EInvoice', entityId: e.id, entityCode: String(e.invoiceId), summary: 'Xóa hóa đơn điện tử nháp' });
    return { ok: true };
  });

  app.get('/api/tax/declaration', { preHandler: requirePermission('tax.view') }, async req => {
    const { year, quarter } = periodInput.parse(req.query);
    return taxDeclaration(db, user(req).branchId, year, quarter);
  });
  app.get('/api/tax/declaration/export', { preHandler: requirePermission('tax.export') }, async (req, reply) => {
    const { year, quarter } = periodInput.parse(req.query);
    const d = await taxDeclaration(db, user(req).branchId, year, quarter);
    const rows: object[] = d.rows.map(r => ({ label: `Thuế suất ${r.rate}%`, gross: r.gross, net: r.net, vat: r.vat }));
    rows.push({ label: 'Tổng cộng', ...d.totals });
    if (d.mode === 'household') rows.push({ label: `Hộ kinh doanh: GTGT ${d.household.vatRate}% + TNCN ${d.household.pitRate}%`, gross: d.household.revenue, net: d.household.pit, vat: d.household.vat });
    return sendXlsx(reply, `to-khai-thue-Q${quarter}-${year}.xlsx`, [
      { header: 'Nhóm', key: 'label' }, { header: 'Doanh thu (gồm thuế)', key: 'gross' }, { header: d.mode === 'household' ? 'Chưa thuế / TNCN' : 'Doanh thu chưa thuế', key: 'net' }, { header: 'Thuế GTGT', key: 'vat' },
    ], rows);
  });
}
