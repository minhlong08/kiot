import { allocateReceiptCosts, receiptTotals, type ReceiptInput } from '@pd/shared';
import type { Tx } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { moveStock, reverseDocument } from './stock';
import { postPartnerLedger, reversePartnerDocument } from './partnerLedger';
import { cancelCashBySource, recordCash } from './cash';
import { resolveUnits } from './purchaseLines';
import { applyReceiptToOrder, assertOrderOpen } from './purchaseOrders';
import type { DocCtx } from './stockDocs';

export async function saveReceipt(tx: Tx, ctx: DocCtx, input: ReceiptInput, id?: number) {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw notFound('Nhà cung cấp');
  if (input.purchaseOrderId) {
    const o = await tx.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
    if (!o || o.branchId !== ctx.branchId) throw notFound('Phiếu đặt hàng nhập');
    await assertOrderOpen(tx, o.id);
  }
  const lines = await resolveUnits(tx, input.lines);
  const alloc = allocateReceiptCosts(lines, input.discount, input.otherCosts);
  const { subtotal, total } = receiptTotals(lines, input.discount, input.otherCosts);
  if (input.paid > total) throw badRequest('PAID_EXCEEDS_TOTAL', 'Tiền trả nhà cung cấp lớn hơn số cần trả');
  if (input.discount > subtotal) throw badRequest('DISCOUNT_EXCEEDS', 'Giảm giá vượt quá tổng tiền hàng');
  const data = {
    supplierId: input.supplierId, purchaseOrderId: input.purchaseOrderId ?? null, invoiceNo: input.invoiceNo, note: input.note,
    subtotal, discount: input.discount, otherCosts: input.otherCosts, total, paid: input.paid, fundId: input.fundId ?? null,
    // Backdating only when explicitly asked (paperwork entered late); otherwise documents are dated when completed.
    ...(input.at ? { createdAt: new Date(input.at), effectiveAt: new Date(input.at) } : {}),
  };
  let r;
  if (id) {
    const cur = await tx.purchaseReceipt.findUnique({ where: { id } });
    if (!cur || cur.branchId !== ctx.branchId) throw notFound('Phiếu nhập hàng');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu tạm');
    await tx.purchaseReceiptLine.deleteMany({ where: { receiptId: id } });
    r = await tx.purchaseReceipt.update({ where: { id }, data });
  } else {
    const prefix = (await getSettings(tx)).orders.codePrefixes.purchaseReceipt;
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.purchaseReceipt.findUnique({ where: { code: c } })));
    r = await tx.purchaseReceipt.create({ data: { ...data, code, branchId: ctx.branchId, createdById: ctx.userId } });
  }
  await tx.purchaseReceiptLine.createMany({
    data: lines.map((l, i) => ({ receiptId: r.id, productId: l.productId, unitId: l.unitId ?? null, conversion: l.conversion, qty: l.qty, unitCost: l.unitCost, discount: l.discount, amount: alloc[i].amount, baseCost: alloc[i].baseCost })),
  });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'PurchaseReceipt', entityId: r.id, entityCode: r.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu nhập hàng ${r.code}` });
  return r;
}

export async function completeReceipt(tx: Tx, ctx: DocCtx, id: number, at?: Date) {
  const r = await tx.purchaseReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!r || r.branchId !== ctx.branchId) throw notFound('Phiếu nhập hàng');
  if (r.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã hoàn thành hoặc đã hủy');
  const when = at ?? r.effectiveAt ?? undefined;
  if (r.purchaseOrderId) await assertOrderOpen(tx, r.purchaseOrderId);
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: r.supplierId } });
  for (const l of r.lines) {
    await moveStock(tx, { productId: l.productId, branchId: r.branchId, qty: l.qty * l.conversion, unitCost: l.baseCost, docType: 'receipt', docId: r.id, docCode: r.code, at: when });
  }
  await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: r.supplierId, amount: r.total, docType: 'receipt', docId: r.id, docCode: r.code, at: when });
  if (r.paid > 0) {
    await recordCash(tx, ctx, { kind: 'out', amount: r.paid, fundId: r.fundId, categoryName: 'Chi tiền trả NCC', counterpartyType: 'supplier', counterpartyId: supplier.id, counterpartyName: supplier.name, sourceType: 'receipt', sourceId: r.id, sourceCode: r.code, codePrefix: 'TTPN', note: `Thanh toán phiếu nhập ${r.code}`, at: when });
    await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: r.supplierId, amount: -r.paid, docType: 'receiptPayment', docId: r.id, docCode: r.code, at: when });
  }
  if (r.purchaseOrderId) await applyReceiptToOrder(tx, r.purchaseOrderId, r.lines, 1);
  await tx.purchaseReceipt.update({ where: { id }, data: { status: 'completed', completedAt: when ?? new Date() } });
  await audit(tx, ctx, { action: 'complete', entity: 'PurchaseReceipt', entityId: id, entityCode: r.code, summary: `Hoàn thành nhập hàng ${r.code}: ${r.total.toLocaleString('en-US')}` });
}

export async function cancelReceipt(tx: Tx, ctx: DocCtx, id: number) {
  const r = await tx.purchaseReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!r || r.branchId !== ctx.branchId) throw notFound('Phiếu nhập hàng');
  if (r.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
  if (r.status === 'completed') {
    if (await tx.purchaseReturn.count({ where: { receiptId: id, status: 'completed' } })) throw conflict('HAS_RETURNS', 'Phiếu đã có trả hàng nhập, hãy hủy phiếu trả trước');
    const allowNegative = (await getSettings(tx)).products.allowNegativeStock;
    await reverseDocument(tx, 'receipt', id, 'receipt_cancel', allowNegative);
    await reversePartnerDocument(tx, 'receipt', id, 'receipt_cancel');
    await reversePartnerDocument(tx, 'receiptPayment', id, 'receiptPayment_cancel');
    await cancelCashBySource(tx, ctx, 'receipt', id);
    if (r.purchaseOrderId) await applyReceiptToOrder(tx, r.purchaseOrderId, r.lines, -1);
  }
  await tx.purchaseReceipt.update({ where: { id }, data: { status: 'cancelled' } });
  await audit(tx, ctx, { action: 'cancel', entity: 'PurchaseReceipt', entityId: id, entityCode: r.code, summary: `Hủy phiếu nhập hàng ${r.code}` });
}
