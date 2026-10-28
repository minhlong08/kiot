import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime, purchaseOrderInputSchema, purchaseReturnInputSchema, receiptInputSchema } from '@pd/shared';
import type { Prisma } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { readXlsx, sendXlsx } from '../lib/excel';
import { badRequest, notFound } from '../lib/errors';
import { linesWithInfo } from '../services/purchaseLines';
import { confirmPurchaseOrder, finishPurchaseOrder, savePurchaseOrder } from '../services/purchaseOrders';
import { cancelReceipt, completeReceipt, saveReceipt } from '../services/receipts';
import { cancelPurchaseReturn, completePurchaseReturn, savePurchaseReturn } from '../services/purchaseReturns';
import type { DocCtx } from '../services/stockDocs';

export const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
export const docCtx = (req: FastifyRequest): DocCtx => { const u = user(req); return { ...req.auditCtx, branchId: u.branchId, userId: u.id }; };

/** Common list filters for purchase documents of the session branch. */
export function purchaseWhere(req: FastifyRequest) {
  const q = req.query as Record<string, unknown>;
  const from = dateParam(q.from), to = dateParam(q.to);
  const statuses = listParam(q.status);
  const suppliers = listParam(q.supplierIds)?.map(Number);
  return {
    branchId: user(req).branchId,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(suppliers ? { supplierId: { in: suppliers } } : {}),
    ...(typeof q.search === 'string' && q.search.trim() ? { code: { contains: q.search.trim().toUpperCase() } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
}

export async function nameMaps(app: FastifyInstance) {
  const [suppliers, users] = await Promise.all([app.prisma.supplier.findMany({ select: { id: true, code: true, name: true } }), app.prisma.user.findMany({ select: { id: true, fullName: true } })]);
  return { supplier: (id: number) => suppliers.find(s => s.id === id), user: (id: number) => users.find(u => u.id === id)?.fullName ?? '' };
}

export async function purchaseOrderRoutes(app: FastifyInstance) {
  const db = app.prisma;
  async function detail(req: FastifyRequest, id: number) {
    const o = await db.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!o || o.branchId !== user(req).branchId) throw notFound('Phiếu đặt hàng nhập');
    const n = await nameMaps(app);
    const lines = await linesWithInfo(db, o.lines);
    return { ...o, supplierCode: n.supplier(o.supplierId)?.code, supplierName: n.supplier(o.supplierId)?.name, createdByName: n.user(o.createdById), lines: lines.map(l => ({ ...l, remainingQty: Math.max(0, l.qty - l.receivedQty) })) };
  }
  app.get('/api/purchase-orders', { preHandler: requirePermission('purchaseOrders.view') }, async req => {
    const q = parseList(req.query);
    const where = purchaseWhere(req) as Prisma.PurchaseOrderWhereInput;
    const [rows, total, sums] = await Promise.all([db.purchaseOrder.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.purchaseOrder.count({ where }), db.purchaseOrder.aggregate({ where, _sum: { total: true } })]);
    const n = await nameMaps(app);
    return { items: rows.map(r => ({ ...r, supplierCode: n.supplier(r.supplierId)?.code, supplierName: n.supplier(r.supplierId)?.name })), total, totals: { total: sums._sum.total ?? 0 } };
  });
  app.get('/api/purchase-orders/:id', { preHandler: requirePermission('purchaseOrders.view') }, async req => detail(req, idOf(req)));
  app.get('/api/purchase-orders/:id/receipt-draft', { preHandler: requirePermission('purchaseReceipts.create') }, async req => {
    const o = await detail(req, idOf(req));
    return { supplierId: o.supplierId, purchaseOrderId: o.id, purchaseOrderCode: o.code, lines: o.lines.filter(l => l.remainingQty > 0).map(l => ({ productId: l.productId, unitId: l.unitId, productCode: l.productCode, productName: l.productName, unit: l.unit, conversion: l.conversion, qty: l.remainingQty, unitCost: l.unitCost, discount: 0 })) };
  });
  app.post('/api/purchase-orders', { preHandler: requirePermission('purchaseOrders.create') }, async req => {
    const b = purchaseOrderInputSchema.parse(req.body);
    const id = await db.$transaction(async tx => {
      const o = await savePurchaseOrder(tx, docCtx(req), b);
      if (b.confirm) await confirmPurchaseOrder(tx, docCtx(req), o.id);
      return o.id;
    });
    return detail(req, id);
  });
  app.put('/api/purchase-orders/:id', { preHandler: requirePermission('purchaseOrders.edit') }, async req => {
    const b = purchaseOrderInputSchema.parse(req.body);
    await detail(req, idOf(req));
    await db.$transaction(async tx => {
      await savePurchaseOrder(tx, docCtx(req), b, idOf(req));
      const o = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: idOf(req) } });
      if (b.confirm && o.status === 'draft') await confirmPurchaseOrder(tx, docCtx(req), idOf(req));
    });
    return detail(req, idOf(req));
  });
  for (const [path, fn, perm] of [
    ['confirm', (tx: Prisma.TransactionClient, req: FastifyRequest) => confirmPurchaseOrder(tx, docCtx(req), idOf(req)), 'purchaseOrders.edit'],
    ['close', (tx: Prisma.TransactionClient, req: FastifyRequest) => finishPurchaseOrder(tx, docCtx(req), idOf(req), 'close'), 'purchaseOrders.edit'],
    ['cancel', (tx: Prisma.TransactionClient, req: FastifyRequest) => finishPurchaseOrder(tx, docCtx(req), idOf(req), 'cancel'), 'purchaseOrders.delete'],
  ] as const) {
    app.post(`/api/purchase-orders/:id/${path}`, { preHandler: requirePermission(perm) }, async req => {
      await detail(req, idOf(req));
      await db.$transaction(tx => fn(tx, req));
      return detail(req, idOf(req));
    });
  }
}

export async function receiptRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const showCost = (req: FastifyRequest) => hasPerm(req.user, 'cost.view');

  async function detail(req: FastifyRequest, id: number) {
    const r = await db.purchaseReceipt.findUnique({ where: { id }, include: { lines: true } });
    if (!r || r.branchId !== user(req).branchId) throw notFound('Phiếu nhập hàng');
    const n = await nameMaps(app);
    const [order, invoices, payments, returns] = await Promise.all([
      r.purchaseOrderId ? db.purchaseOrder.findUnique({ where: { id: r.purchaseOrderId }, select: { code: true } }) : null,
      db.incomingInvoice.findMany({ where: { receiptId: id } }),
      db.cashVoucher.findMany({ where: { sourceType: 'receipt', sourceId: id } }),
      db.purchaseReturn.findMany({ where: { receiptId: id }, select: { id: true, code: true, status: true, total: true } }),
    ]);
    const lines = (await linesWithInfo(db, r.lines)).map(({ baseCost, ...l }) => ({ ...l, ...(showCost(req) ? { baseCost } : {}) }));
    return {
      ...r, debt: r.total - r.paid, supplierCode: n.supplier(r.supplierId)?.code, supplierName: n.supplier(r.supplierId)?.name, createdByName: n.user(r.createdById),
      purchaseOrderCode: order?.code ?? null, invoices, payments, returns, lines,
    };
  }

  const where = (req: FastifyRequest): Prisma.PurchaseReceiptWhereInput => {
    const invoiceNo = (req.query as { invoiceNo?: string }).invoiceNo?.trim();
    return { ...(purchaseWhere(req) as Prisma.PurchaseReceiptWhereInput), ...(invoiceNo ? { invoiceNo: { contains: invoiceNo } } : {}) };
  };

  async function listRows(req: FastifyRequest, page?: { skip: number; take: number }) {
    const invoiceNo = (req.query as { invoiceNo?: string }).invoiceNo?.trim();
    let w = where(req);
    if (invoiceNo) {
      const linked = await db.incomingInvoice.findMany({ where: { invoiceNo: { contains: invoiceNo }, receiptId: { not: null } }, select: { receiptId: true } });
      const { invoiceNo: _i, ...rest } = w;
      w = { ...rest, OR: [{ invoiceNo: { contains: invoiceNo } }, { id: { in: linked.map(l => l.receiptId!) } }] };
    }
    const [rows, total, sums] = await Promise.all([
      db.purchaseReceipt.findMany({ where: w, orderBy: { createdAt: 'desc' }, ...(page ?? {}) }),
      db.purchaseReceipt.count({ where: w }),
      db.purchaseReceipt.aggregate({ where: w, _sum: { total: true, paid: true } }),
    ]);
    const n = await nameMaps(app);
    return {
      items: rows.map(r => ({ ...r, debt: r.total - r.paid, supplierCode: n.supplier(r.supplierId)?.code, supplierName: n.supplier(r.supplierId)?.name, createdByName: n.user(r.createdById) })),
      total, totals: { total: sums._sum.total ?? 0, paid: sums._sum.paid ?? 0, debt: (sums._sum.total ?? 0) - (sums._sum.paid ?? 0) },
    };
  }

  app.get('/api/purchase-receipts', { preHandler: requirePermission('purchaseReceipts.view') }, async req => {
    const q = parseList(req.query);
    return listRows(req, { skip: q.skip, take: q.take });
  });
  app.get('/api/purchase-receipts/export', { preHandler: requirePermission('purchaseReceipts.export', 'purchaseReceipts.view') }, async (req, reply) => {
    const { items } = await listRows(req);
    return sendXlsx(reply, 'nhap-hang.xlsx', [
      { header: 'Mã nhập hàng', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Mã NCC', key: 'supplierCode' }, { header: 'Nhà cung cấp', key: 'supplierName', width: 30 },
      { header: 'Số HĐ đầu vào', key: 'invoiceNo' }, { header: 'Tổng tiền hàng', key: 'subtotal', money: true }, { header: 'Giảm giá', key: 'discount', money: true },
      { header: 'Chi phí nhập', key: 'otherCosts', money: true }, { header: 'Cần trả NCC', key: 'total', money: true }, { header: 'Đã trả NCC', key: 'paid', money: true },
      { header: 'Còn nợ', key: 'debt', money: true }, { header: 'Trạng thái', key: 'status' },
    ], items.map(i => ({ ...i, time: formatDateTime(i.createdAt) })));
  });
  const LINE_COLUMNS = [{ header: 'Mã hàng', key: 'code' }, { header: 'Số lượng', key: 'qty' }, { header: 'Đơn giá', key: 'cost', money: true }, { header: 'Giảm giá', key: 'disc', money: true }];
  app.get('/api/purchase-receipts/lines-template', { preHandler: requirePermission('purchaseReceipts.create') }, async (_req, reply) =>
    sendXlsx(reply, 'mau-nhap-hang.xlsx', LINE_COLUMNS, [{ code: 'NA001', qty: 10, cost: 800_000, disc: 0 }]));
  app.post('/api/purchase-receipts/lines-import', { preHandler: requirePermission('purchaseReceipts.create') }, async req => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Chưa chọn file');
    let rows: Record<string, unknown>[];
    try { rows = await readXlsx(await file.toBuffer()); } catch { throw badRequest('BAD_FILE', 'File không đúng định dạng Excel (.xlsx)'); }
    const codes = rows.map(r => String(r['Mã hàng'] ?? '').trim());
    const [products, units] = await Promise.all([db.product.findMany({ where: { code: { in: codes }, type: 'goods' } }), db.productUnit.findMany({ where: { code: { in: codes } } })]);
    const unitProducts = await db.product.findMany({ where: { id: { in: units.map(u => u.productId) } } });
    const lines: object[] = [];
    const errors: { row: number; message: string }[] = [];
    rows.forEach((r, i) => {
      const code = codes[i];
      const qty = Number(String(r['Số lượng'] ?? '').replace(/,/g, ''));
      const cost = Number(String(r['Đơn giá'] ?? '0').replace(/,/g, '')) || 0;
      const disc = Number(String(r['Giảm giá'] ?? '0').replace(/,/g, '')) || 0;
      const p = products.find(x => x.code === code);
      const u = units.find(x => x.code === code);
      const up = u ? unitProducts.find(x => x.id === u.productId) : undefined;
      if (!p && !up) return errors.push({ row: i + 2, message: `Không tìm thấy mã hàng ${code}` });
      if (!Number.isInteger(qty) || qty < 1) return errors.push({ row: i + 2, message: 'Số lượng không hợp lệ' });
      const prod = (p ?? up)!;
      lines.push({ productId: prod.id, unitId: u?.id ?? null, productCode: code, productName: prod.name, unit: u?.name ?? prod.unit, conversion: u?.conversion ?? 1, qty, unitCost: Math.round(cost), discount: Math.round(disc) });
    });
    return { lines, errors };
  });
  app.get('/api/purchase-receipts/:id', { preHandler: requirePermission('purchaseReceipts.view') }, async req => detail(req, idOf(req)));
  app.post('/api/purchase-receipts', { preHandler: requirePermission('purchaseReceipts.create') }, async req => {
    const b = receiptInputSchema.parse(req.body);
    const id = await db.$transaction(async tx => {
      const r = await saveReceipt(tx, docCtx(req), b);
      if (b.complete) await completeReceipt(tx, docCtx(req), r.id, b.at ? new Date(b.at) : undefined);
      return r.id;
    });
    return detail(req, id);
  });
  app.put('/api/purchase-receipts/:id', { preHandler: requirePermission('purchaseReceipts.edit') }, async req => {
    const b = receiptInputSchema.parse(req.body);
    await db.$transaction(async tx => {
      await saveReceipt(tx, docCtx(req), b, idOf(req));
      if (b.complete) await completeReceipt(tx, docCtx(req), idOf(req));
    });
    return detail(req, idOf(req));
  });
  app.post('/api/purchase-receipts/:id/complete', { preHandler: requirePermission('purchaseReceipts.edit', 'purchaseReceipts.create') }, async req => {
    await db.$transaction(tx => completeReceipt(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
  app.post('/api/purchase-receipts/:id/cancel', { preHandler: requirePermission('purchaseReceipts.delete') }, async req => {
    await db.$transaction(tx => cancelReceipt(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
}

export async function purchaseReturnRoutes(app: FastifyInstance) {
  const db = app.prisma;

  async function detail(req: FastifyRequest, id: number) {
    const r = await db.purchaseReturn.findUnique({ where: { id }, include: { lines: true } });
    if (!r || r.branchId !== user(req).branchId) throw notFound('Phiếu trả hàng nhập');
    const n = await nameMaps(app);
    const receipt = r.receiptId ? await db.purchaseReceipt.findUnique({ where: { id: r.receiptId }, select: { code: true } }) : null;
    const lines = (await linesWithInfo(db, r.lines)).map(({ cost, ...l }) => ({ ...l, ...(hasPerm(req.user, 'cost.view') ? { cost } : {}) }));
    return { ...r, supplierCode: n.supplier(r.supplierId)?.code, supplierName: n.supplier(r.supplierId)?.name, createdByName: n.user(r.createdById), receiptCode: receipt?.code ?? null, lines };
  }

  app.get('/api/purchase-receipts/:id/return-draft', { preHandler: requirePermission('purchaseReturns.create') }, async req => {
    const r = await db.purchaseReceipt.findUnique({ where: { id: idOf(req) }, include: { lines: true } });
    if (!r || r.branchId !== user(req).branchId || r.status !== 'completed') throw notFound('Phiếu nhập hàng');
    const lines = await linesWithInfo(db, r.lines);
    return {
      supplierId: r.supplierId, receiptId: r.id, receiptCode: r.code,
      lines: lines.map(l => ({
        productId: l.productId, unitId: l.unitId, productCode: l.productCode, productName: l.productName, unit: l.unit, conversion: l.conversion,
        qty: Math.floor((l.qty * l.conversion - l.returnedQty) / l.conversion), price: Math.round((l.qty * l.unitCost - l.discount) / l.qty),
      })).filter(l => l.qty > 0),
    };
  });

  app.get('/api/purchase-returns', { preHandler: requirePermission('purchaseReturns.view') }, async req => {
    const q = parseList(req.query);
    const where = purchaseWhere(req) as Prisma.PurchaseReturnWhereInput;
    const [rows, total, sums] = await Promise.all([db.purchaseReturn.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.purchaseReturn.count({ where }), db.purchaseReturn.aggregate({ where, _sum: { total: true, refund: true } })]);
    const n = await nameMaps(app);
    return { items: rows.map(r => ({ ...r, supplierCode: n.supplier(r.supplierId)?.code, supplierName: n.supplier(r.supplierId)?.name })), total, totals: { total: sums._sum.total ?? 0, refund: sums._sum.refund ?? 0 } };
  });
  app.get('/api/purchase-returns/export', { preHandler: requirePermission('purchaseReturns.export', 'purchaseReturns.view') }, async (req, reply) => {
    const n = await nameMaps(app);
    const rows = await db.purchaseReturn.findMany({ where: purchaseWhere(req) as Prisma.PurchaseReturnWhereInput, orderBy: { id: 'desc' } });
    return sendXlsx(reply, 'tra-hang-nhap.xlsx', [
      { header: 'Mã trả hàng nhập', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Nhà cung cấp', key: 'supplier', width: 30 },
      { header: 'Tổng tiền hàng', key: 'subtotal', money: true }, { header: 'Giảm giá', key: 'discount', money: true }, { header: 'NCC cần trả', key: 'total', money: true },
      { header: 'NCC đã trả', key: 'refund', money: true }, { header: 'Trạng thái', key: 'status' },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt), supplier: n.supplier(r.supplierId)?.name })));
  });
  app.get('/api/purchase-returns/:id', { preHandler: requirePermission('purchaseReturns.view') }, async req => detail(req, idOf(req)));
  app.post('/api/purchase-returns', { preHandler: requirePermission('purchaseReturns.create') }, async req => {
    const b = purchaseReturnInputSchema.parse(req.body);
    const id = await db.$transaction(async tx => {
      const r = await savePurchaseReturn(tx, docCtx(req), b);
      if (b.complete) await completePurchaseReturn(tx, docCtx(req), r.id);
      return r.id;
    });
    return detail(req, id);
  });
  app.put('/api/purchase-returns/:id', { preHandler: requirePermission('purchaseReturns.edit') }, async req => {
    const b = purchaseReturnInputSchema.parse(req.body);
    await db.$transaction(async tx => {
      await savePurchaseReturn(tx, docCtx(req), b, idOf(req));
      if (b.complete) await completePurchaseReturn(tx, docCtx(req), idOf(req));
    });
    return detail(req, idOf(req));
  });
  app.post('/api/purchase-returns/:id/complete', { preHandler: requirePermission('purchaseReturns.edit', 'purchaseReturns.create') }, async req => {
    await db.$transaction(tx => completePurchaseReturn(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
  app.post('/api/purchase-returns/:id/cancel', { preHandler: requirePermission('purchaseReturns.delete') }, async req => {
    await db.$transaction(tx => cancelPurchaseReturn(tx, docCtx(req), idOf(req)));
    return detail(req, idOf(req));
  });
}
