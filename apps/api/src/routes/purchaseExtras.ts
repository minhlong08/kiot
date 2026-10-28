import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime, moneySchema } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { readXlsx, sendXlsx } from '../lib/excel';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { postPartnerLedger, reversePartnerDocument } from '../services/partnerLedger';
import { cancelCashBySource, recordCash } from '../services/cash';
import { docCtx, idOf } from './purchasing';

const invoiceInput = z.object({
  invoiceNo: z.string().trim().min(1, 'Nhập số hóa đơn').max(30),
  series: z.string().trim().max(20).default(''),
  issuedAt: z.string().datetime({ offset: true }),
  supplierId: z.number().int().nullable().optional(),
  supplierName: z.string().trim().max(200).default(''),
  supplierTaxCode: z.string().trim().max(20).default(''),
  subtotal: moneySchema.default(0), vatAmount: moneySchema.default(0), total: moneySchema.default(0),
  note: z.string().max(500).default(''),
});

const INVOICE_COLUMNS = [
  { header: 'Ký hiệu', key: 'series' }, { header: 'Số hóa đơn', key: 'invoiceNo' }, { header: 'Ngày', key: 'issuedAt' },
  { header: 'MST người bán', key: 'supplierTaxCode' }, { header: 'Tên người bán', key: 'supplierName', width: 30 },
  { header: 'Tiền hàng', key: 'subtotal', money: true }, { header: 'Tiền thuế', key: 'vatAmount', money: true }, { header: 'Tổng tiền', key: 'total', money: true },
];

export async function incomingInvoiceRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const where = (req: FastifyRequest): Prisma.IncomingInvoiceWhereInput => {
    const q = req.query as Record<string, unknown>;
    const from = dateParam(q.from), to = dateParam(q.to);
    return {
      ...(q.linked === 'true' ? { OR: [{ receiptId: { not: null } }, { purchaseOrderId: { not: null } }] } : q.linked === 'false' ? { receiptId: null, purchaseOrderId: null } : {}),
      ...(typeof q.search === 'string' && q.search.trim() ? { invoiceNo: { contains: q.search.trim() } } : {}),
      ...(listParam(q.supplierIds) ? { supplierId: { in: listParam(q.supplierIds)!.map(Number) } } : {}),
      ...(from || to ? { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
  };
  async function withLinks<T extends { receiptId: number | null; purchaseOrderId: number | null }>(rows: T[]) {
    const [rs, os] = await Promise.all([
      db.purchaseReceipt.findMany({ where: { id: { in: rows.map(r => r.receiptId ?? 0) } }, select: { id: true, code: true } }),
      db.purchaseOrder.findMany({ where: { id: { in: rows.map(r => r.purchaseOrderId ?? 0) } }, select: { id: true, code: true } }),
    ]);
    return rows.map(r => ({ ...r, receiptCode: rs.find(x => x.id === r.receiptId)?.code ?? null, purchaseOrderCode: os.find(x => x.id === r.purchaseOrderId)?.code ?? null }));
  }
  app.get('/api/incoming-invoices', { preHandler: requirePermission('incomingInvoices.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([db.incomingInvoice.findMany({ where: w, orderBy: { issuedAt: 'desc' }, skip: q.skip, take: q.take }), db.incomingInvoice.count({ where: w }), db.incomingInvoice.aggregate({ where: w, _sum: { subtotal: true, vatAmount: true, total: true } })]);
    return { items: await withLinks(rows), total, totals: { subtotal: sums._sum.subtotal ?? 0, vatAmount: sums._sum.vatAmount ?? 0, total: sums._sum.total ?? 0 } };
  });
  app.get('/api/incoming-invoices/export', { preHandler: requirePermission('incomingInvoices.view') }, async (req, reply) =>
    sendXlsx(reply, 'hoa-don-dau-vao.xlsx', INVOICE_COLUMNS, (await db.incomingInvoice.findMany({ where: where(req), orderBy: { issuedAt: 'desc' } })).map(r => ({ ...r, issuedAt: formatDateTime(r.issuedAt) }))));
  app.get('/api/incoming-invoices/import-template', async (_req, reply) =>
    sendXlsx(reply, 'mau-hoa-don-dau-vao.xlsx', INVOICE_COLUMNS, [{ series: '1C26TAA', invoiceNo: '0000123', issuedAt: '20/10/2026', supplierTaxCode: '0312345678', supplierName: 'Công ty May Mẫu', subtotal: 1_000_000, vatAmount: 80_000, total: 1_080_000 }]));

  const save = (req: FastifyRequest, id?: number) => db.$transaction(async tx => {
    const b = invoiceInput.parse(req.body);
    const data = { ...b, issuedAt: new Date(b.issuedAt), supplierId: b.supplierId ?? null };
    if (data.supplierId && !data.supplierName) {
      const s = await tx.supplier.findUnique({ where: { id: data.supplierId } });
      if (s) Object.assign(data, { supplierName: s.name, supplierTaxCode: data.supplierTaxCode || s.taxCode });
    }
    const dup = await tx.incomingInvoice.findFirst({ where: { series: data.series, invoiceNo: data.invoiceNo, supplierTaxCode: data.supplierTaxCode, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw conflict('DUPLICATE', `Hóa đơn ${data.series} ${data.invoiceNo} đã tồn tại`);
    const row = id ? await tx.incomingInvoice.update({ where: { id }, data }) : await tx.incomingInvoice.create({ data });
    await audit(tx, req.auditCtx, { action: id ? 'update' : 'create', entity: 'IncomingInvoice', entityId: row.id, entityCode: row.invoiceNo, summary: `${id ? 'Cập nhật' : 'Thêm'} hóa đơn đầu vào ${row.series} ${row.invoiceNo}` });
    return row;
  });
  app.post('/api/incoming-invoices', { preHandler: requirePermission('incomingInvoices.create') }, async req => save(req));
  app.put('/api/incoming-invoices/:id', { preHandler: requirePermission('incomingInvoices.edit') }, async req => save(req, idOf(req)));
  app.delete('/api/incoming-invoices/:id', { preHandler: requirePermission('incomingInvoices.delete') }, async req =>
    db.$transaction(async tx => {
      const row = await tx.incomingInvoice.delete({ where: { id: idOf(req) } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'IncomingInvoice', entityId: row.id, entityCode: row.invoiceNo, summary: `Xóa hóa đơn đầu vào ${row.invoiceNo}`, before: row });
      return { ok: true };
    }));
  app.post('/api/incoming-invoices/:id/link', { preHandler: requirePermission('incomingInvoices.edit') }, async req => {
    const { receiptId, purchaseOrderId } = z.object({ receiptId: z.number().int().nullable().optional(), purchaseOrderId: z.number().int().nullable().optional() }).parse(req.body);
    return db.$transaction(async tx => {
      const branchId = user(req).branchId;
      if (receiptId && (await tx.purchaseReceipt.findUnique({ where: { id: receiptId } }))?.branchId !== branchId) throw notFound('Phiếu nhập hàng');
      if (purchaseOrderId && (await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } }))?.branchId !== branchId) throw notFound('Phiếu đặt hàng nhập');
      const row = await tx.incomingInvoice.update({ where: { id: idOf(req) }, data: { receiptId: receiptId ?? null, purchaseOrderId: purchaseOrderId ?? null } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'IncomingInvoice', entityId: row.id, entityCode: row.invoiceNo, summary: `Liên kết hóa đơn đầu vào ${row.invoiceNo}` });
      return row;
    });
  });
  app.post('/api/incoming-invoices/import', { preHandler: requirePermission('incomingInvoices.create') }, async req => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Chưa chọn file');
    let rows: Record<string, unknown>[];
    try { rows = await readXlsx(await file.toBuffer()); } catch { throw badRequest('BAD_FILE', 'File không đúng định dạng Excel (.xlsx)'); }
    const errors: { row: number; message: string }[] = [];
    const parsed: z.infer<typeof invoiceInput>[] = [];
    rows.forEach((r, i) => {
      const get = (h: string) => r[h];
      const dateRaw = get('Ngày');
      const date = dateRaw instanceof Date ? dateRaw : typeof dateRaw === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateRaw.trim())
        ? new Date(`${dateRaw.trim().split('/').reverse().map(x => x.padStart(2, '0')).join('-')}T00:00:00+07:00`) : null;
      const res = invoiceInput.safeParse({
        series: String(get('Ký hiệu') ?? ''), invoiceNo: String(get('Số hóa đơn') ?? ''), issuedAt: date?.toISOString() ?? '',
        supplierTaxCode: String(get('MST người bán') ?? ''), supplierName: String(get('Tên người bán') ?? ''),
        subtotal: Number(get('Tiền hàng') ?? 0), vatAmount: Number(get('Tiền thuế') ?? 0), total: Number(get('Tổng tiền') ?? 0),
      });
      if (!res.success) errors.push({ row: i + 2, message: res.error.issues[0].message });
      else parsed.push(res.data);
    });
    if (errors.length) return { created: 0, errors };
    return db.$transaction(async tx => {
      for (const [i, p] of parsed.entries()) {
        if (await tx.incomingInvoice.findFirst({ where: { series: p.series, invoiceNo: p.invoiceNo, supplierTaxCode: p.supplierTaxCode } })) {
          errors.push({ row: i + 2, message: `Hóa đơn ${p.invoiceNo} đã tồn tại` });
          continue;
        }
        const s = p.supplierTaxCode ? await tx.supplier.findFirst({ where: { taxCode: p.supplierTaxCode } }) : null;
        await tx.incomingInvoice.create({ data: { ...p, issuedAt: new Date(p.issuedAt), supplierId: s?.id ?? null } });
      }
      if (errors.length) throw Object.assign(new Error('dup'), { importErrors: errors });
      await audit(tx, req.auditCtx, { action: 'import', entity: 'IncomingInvoice', entityId: 'import', summary: `Import ${parsed.length} hóa đơn đầu vào` });
      return { created: parsed.length, errors: [] };
    }).catch((e: { importErrors?: typeof errors }) => {
      if (e.importErrors) return { created: 0, errors: e.importErrors };
      throw e;
    });
  });
}

const serviceInput = z.object({
  supplierId: z.number().int().nullable().optional(),
  serviceName: z.string().trim().min(1, 'Nhập tên dịch vụ').max(200),
  categoryId: z.number().int().optional(),
  amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'),
  paid: moneySchema.default(0),
  fundId: z.number().int().nullable().optional(),
  note: z.string().max(500).default(''),
  at: z.string().datetime({ offset: true }).optional(),
});

export async function servicePurchaseRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const where = (req: FastifyRequest): Prisma.ServicePurchaseWhereInput => {
    const q = req.query as Record<string, unknown>;
    const from = dateParam(q.from), to = dateParam(q.to);
    return {
      branchId: user(req).branchId,
      ...(listParam(q.status) ? { status: { in: listParam(q.status)! } } : {}),
      ...(typeof q.search === 'string' && q.search.trim() ? { OR: [{ code: { contains: q.search.trim().toUpperCase() } }, { serviceName: { contains: q.search.trim() } }] } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    };
  };
  app.get('/api/service-purchases', { preHandler: requirePermission('servicePurchases.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums, suppliers, categories] = await Promise.all([
      db.servicePurchase.findMany({ where: w, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.servicePurchase.count({ where: w }),
      db.servicePurchase.aggregate({ where: { ...w, status: 'completed' }, _sum: { amount: true, paid: true } }),
      db.supplier.findMany({ select: { id: true, name: true } }), db.cashCategory.findMany(),
    ]);
    return {
      items: rows.map(r => ({ ...r, supplierName: suppliers.find(s => s.id === r.supplierId)?.name ?? '', categoryName: categories.find(c => c.id === r.categoryId)?.name ?? '' })),
      total, totals: { amount: sums._sum.amount ?? 0, paid: sums._sum.paid ?? 0 },
    };
  });
  app.post('/api/service-purchases', { preHandler: requirePermission('servicePurchases.create') }, async req => {
    const b = serviceInput.parse(req.body);
    if (b.paid > b.amount) throw badRequest('PAID_EXCEEDS_TOTAL', 'Số tiền trả lớn hơn giá trị dịch vụ');
    if (!b.supplierId && b.paid < b.amount) throw badRequest('NEEDS_SUPPLIER', 'Chọn nhà cung cấp để ghi nợ phần chưa trả');
    const ctx = docCtx(req);
    const at = b.at ? new Date(b.at) : undefined;
    return db.$transaction(async tx => {
      const supplier = b.supplierId ? await tx.supplier.findUnique({ where: { id: b.supplierId } }) : null;
      if (b.supplierId && !supplier) throw notFound('Nhà cung cấp');
      const category = b.categoryId ? await tx.cashCategory.findUnique({ where: { id: b.categoryId } }) : await tx.cashCategory.findUnique({ where: { kind_name: { kind: 'out', name: 'Chi phí dịch vụ' } } });
      if (!category || category.kind !== 'out') throw notFound('Loại chi');
      const prefix = (await getSettings(tx)).orders.codePrefixes.servicePurchase;
      const code = await docCode(tx, prefix, undefined, async c => !!(await tx.servicePurchase.findUnique({ where: { code: c } })));
      const sp = await tx.servicePurchase.create({ data: { code, supplierId: b.supplierId ?? null, branchId: ctx.branchId, serviceName: b.serviceName, categoryId: category.id, amount: b.amount, paid: b.paid, fundId: b.fundId ?? null, note: b.note, createdById: ctx.userId, ...(at ? { createdAt: at } : {}) } });
      await recordCash(tx, { ...ctx }, { kind: 'out', amount: b.paid, fundId: b.fundId, categoryId: category.id, counterpartyType: supplier ? 'supplier' : 'other', counterpartyId: supplier?.id, counterpartyName: supplier?.name ?? b.serviceName, sourceType: 'servicePurchase', sourceId: sp.id, sourceCode: code, codePrefix: 'TTMDV', note: b.serviceName, affectsPnl: true, at });
      // Unpaid part of the expense is owed to the supplier; the full amount is the expense (paid now + paid later via supplier payments).
      if (supplier) await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: supplier.id, amount: b.amount - b.paid, docType: 'servicePurchase', docId: sp.id, docCode: code, at });
      await audit(tx, ctx, { action: 'create', entity: 'ServicePurchase', entityId: sp.id, entityCode: code, summary: `Mua dịch vụ ${code}: ${b.serviceName} ${b.amount.toLocaleString('en-US')}` });
      return sp;
    });
  });
  app.post('/api/service-purchases/:id/cancel', { preHandler: requirePermission('servicePurchases.delete') }, async req => {
    const ctx = docCtx(req);
    return db.$transaction(async tx => {
      const sp = await tx.servicePurchase.findUnique({ where: { id: idOf(req) } });
      if (!sp || sp.branchId !== ctx.branchId) throw notFound('Phiếu mua dịch vụ');
      if (sp.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
      await cancelCashBySource(tx, ctx, 'servicePurchase', sp.id);
      await reversePartnerDocument(tx, 'servicePurchase', sp.id, 'servicePurchase_cancel');
      const row = await tx.servicePurchase.update({ where: { id: sp.id }, data: { status: 'cancelled' } });
      await audit(tx, ctx, { action: 'cancel', entity: 'ServicePurchase', entityId: sp.id, entityCode: sp.code, summary: `Hủy phiếu mua dịch vụ ${sp.code}` });
      return row;
    });
  });
}
