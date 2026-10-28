import type { PurchaseOrderInput } from '@pd/shared';
import { receiptTotals } from '@pd/shared';
import type { Tx } from '../db';
import { conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { adjustCounter } from './stock';
import { resolveUnits } from './purchaseLines';
import type { DocCtx } from './stockDocs';

export async function savePurchaseOrder(tx: Tx, ctx: DocCtx, input: PurchaseOrderInput, id?: number) {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw notFound('Nhà cung cấp');
  const lines = await resolveUnits(tx, input.lines);
  const { subtotal, total } = receiptTotals(lines, input.discount, 0);
  const data = { supplierId: input.supplierId, note: input.note, discount: input.discount, subtotal, total, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null };
  let o;
  if (id) {
    const cur = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!cur) throw notFound('Phiếu đặt hàng nhập');
    if (!['draft', 'confirmed'].includes(cur.status) || cur.lines.some(l => l.receivedQty > 0)) throw conflict('NOT_EDITABLE', 'Phiếu đã nhập hàng, không thể sửa');
    if (cur.status === 'confirmed') for (const l of cur.lines) await adjustCounter(tx, l.productId, cur.branchId, 'incoming', -l.qty * l.conversion);
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    o = await tx.purchaseOrder.update({ where: { id }, data });
    if (cur.status === 'confirmed') for (const l of lines) await adjustCounter(tx, l.productId, cur.branchId, 'incoming', l.qty * l.conversion);
  } else {
    const prefix = (await getSettings(tx)).orders.codePrefixes.purchaseOrder;
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.purchaseOrder.findUnique({ where: { code: c } })));
    o = await tx.purchaseOrder.create({ data: { ...data, code, branchId: ctx.branchId, createdById: ctx.userId } });
  }
  await tx.purchaseOrderLine.createMany({ data: lines.map(l => ({ orderId: o.id, productId: l.productId, unitId: l.unitId ?? null, conversion: l.conversion, qty: l.qty, unitCost: l.unitCost, discount: l.discount })) });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'PurchaseOrder', entityId: o.id, entityCode: o.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu đặt hàng nhập ${o.code}` });
  return o;
}

export async function confirmPurchaseOrder(tx: Tx, ctx: DocCtx, id: number) {
  const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o) throw notFound('Phiếu đặt hàng nhập');
  if (o.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã xác nhận');
  for (const l of o.lines) await adjustCounter(tx, l.productId, o.branchId, 'incoming', l.qty * l.conversion);
  await tx.purchaseOrder.update({ where: { id }, data: { status: 'confirmed', confirmedAt: new Date() } });
  await audit(tx, ctx, { action: 'complete', entity: 'PurchaseOrder', entityId: id, entityCode: o.code, summary: `Đặt hàng nhập ${o.code}` });
}

export async function assertOrderOpen(tx: Tx, orderId: number) {
  const o = await tx.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!o || ['draft', 'cancelled'].includes(o.status) || o.closedManually) throw conflict('ORDER_NOT_OPEN', 'Phiếu đặt hàng nhập chưa xác nhận hoặc đã kết thúc');
}

/** Releases what is still expected and closes (completed) or cancels the order. */
export async function finishPurchaseOrder(tx: Tx, ctx: DocCtx, id: number, how: 'close' | 'cancel') {
  const o = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o) throw notFound('Phiếu đặt hàng nhập');
  if (['completed', 'cancelled'].includes(o.status)) throw conflict('ALREADY_DONE', 'Phiếu đã kết thúc');
  if (how === 'cancel' && o.lines.some(l => l.receivedQty > 0)) throw conflict('HAS_RECEIPTS', 'Phiếu đã nhập một phần, hãy dùng Kết thúc');
  if (o.status !== 'draft') {
    for (const l of o.lines) await adjustCounter(tx, l.productId, o.branchId, 'incoming', -Math.max(0, l.qty - l.receivedQty) * l.conversion);
  }
  await tx.purchaseOrder.update({ where: { id }, data: { status: how === 'close' ? 'completed' : 'cancelled', closedManually: how === 'close' } });
  await audit(tx, ctx, { action: how === 'close' ? 'complete' : 'cancel', entity: 'PurchaseOrder', entityId: id, entityCode: o.code, summary: `${how === 'close' ? 'Kết thúc' : 'Hủy'} phiếu đặt hàng nhập ${o.code}` });
}

/**
 * Applies received quantities (positive) or a receipt cancellation (negative) to the order.
 * `incoming` is reduced only by what was still outstanding, so it never goes below zero.
 */
export async function applyReceiptToOrder(tx: Tx, orderId: number, lines: { productId: number; unitId: number | null; qty: number }[], sign: 1 | -1) {
  const o = await tx.purchaseOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!o) throw notFound('Phiếu đặt hàng nhập');
  for (const l of lines) {
    const ol = o.lines.find(x => x.productId === l.productId && (x.unitId ?? null) === (l.unitId ?? null)) ?? o.lines.find(x => x.productId === l.productId);
    if (!ol) continue;
    const qtyInOrderUnits = l.qty;
    const before = ol.receivedQty;
    const after = Math.max(0, before + sign * qtyInOrderUnits);
    const outstanding = (r: number) => Math.max(0, ol.qty - r);
    const deltaIncoming = (outstanding(after) - outstanding(before)) * ol.conversion;
    // A cancelled or manually closed order has already released its incoming quantity.
    if (o.status !== 'cancelled' && !o.closedManually) await adjustCounter(tx, ol.productId, o.branchId, 'incoming', deltaIncoming);
    await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQty: after } });
    ol.receivedQty = after;
  }
  if (o.status === 'cancelled' || o.closedManually) return;
  const anyReceived = o.lines.some(l => l.receivedQty > 0);
  const allReceived = o.lines.every(l => l.receivedQty >= l.qty);
  const status = allReceived ? 'completed' : anyReceived ? 'partial' : o.confirmedAt ? 'confirmed' : 'draft';
  await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
}
