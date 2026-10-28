import type { PurchaseReturnInput } from '@pd/shared';
import type { Tx } from '../db';
import { transition } from './transition';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { moveStock, reverseDocument } from './stock';
import { postPartnerLedger, reversePartnerDocument } from './partnerLedger';
import { cancelCashBySource, recordCash } from './cash';
import { resolveUnits } from './purchaseLines';
import type { DocCtx } from './stockDocs';

export async function savePurchaseReturn(tx: Tx, ctx: DocCtx, input: PurchaseReturnInput, id?: number) {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw notFound('Nhà cung cấp');
  if (input.receiptId) {
    const r = await tx.purchaseReceipt.findUnique({ where: { id: input.receiptId } });
    if (!r || r.branchId !== ctx.branchId || r.status !== 'completed') throw notFound('Phiếu nhập hàng');
    if (r.supplierId !== input.supplierId) throw badRequest('SUPPLIER_MISMATCH', 'Nhà cung cấp khác với phiếu nhập');
  }
  const lines = await resolveUnits(tx, input.lines);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const total = Math.max(0, subtotal - input.discount);
  if (input.refund > total) throw badRequest('REFUND_EXCEEDS_TOTAL', 'Tiền NCC trả lớn hơn giá trị trả hàng');
  const data = { supplierId: input.supplierId, receiptId: input.receiptId ?? null, note: input.note, subtotal, discount: input.discount, total, refund: input.refund, fundId: input.fundId ?? null };
  let ret;
  if (id) {
    const cur = await tx.purchaseReturn.findUnique({ where: { id } });
    if (!cur || cur.branchId !== ctx.branchId) throw notFound('Phiếu trả hàng nhập');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu tạm');
    await tx.purchaseReturnLine.deleteMany({ where: { returnId: id } });
    ret = await tx.purchaseReturn.update({ where: { id }, data });
  } else {
    const prefix = (await getSettings(tx)).orders.codePrefixes.purchaseReturn;
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.purchaseReturn.findUnique({ where: { code: c } })));
    ret = await tx.purchaseReturn.create({ data: { ...data, code, branchId: ctx.branchId, createdById: ctx.userId } });
  }
  await tx.purchaseReturnLine.createMany({ data: lines.map(l => ({ returnId: ret.id, productId: l.productId, unitId: l.unitId ?? null, conversion: l.conversion, qty: l.qty, price: l.price, amount: l.qty * l.price })) });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'PurchaseReturn', entityId: ret.id, entityCode: ret.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu trả hàng nhập ${ret.code}` });
  return ret;
}

/** Moves the returned base quantity onto the source receipt lines (sign −1 on cancel). */
async function applyToReceipt(tx: Tx, receiptId: number, lines: { productId: number; qty: number; conversion: number }[], sign: 1 | -1) {
  const rl = await tx.purchaseReceiptLine.findMany({ where: { receiptId } });
  for (const l of lines) {
    let left = l.qty * l.conversion;
    for (const r of rl.filter(x => x.productId === l.productId)) {
      if (!left) break;
      const capacity = sign > 0 ? r.qty * r.conversion - r.returnedQty : r.returnedQty;
      const take = Math.min(capacity, left);
      if (take > 0) {
        await tx.purchaseReceiptLine.update({ where: { id: r.id }, data: { returnedQty: { increment: sign * take } } });
        r.returnedQty += sign * take;
        left -= take;
      }
    }
    if (left > 0 && sign > 0) throw conflict('RETURN_EXCEEDS_RECEIPT', 'Số lượng trả vượt quá số lượng còn lại của phiếu nhập');
  }
}

export async function completePurchaseReturn(tx: Tx, ctx: DocCtx, id: number) {
  const ret = await tx.purchaseReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!ret || ret.branchId !== ctx.branchId) throw notFound('Phiếu trả hàng nhập');
  if (ret.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã hoàn thành hoặc đã hủy');
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: ret.supplierId } });
  if (ret.receiptId) {
    const receipt = await tx.purchaseReceipt.findUnique({ where: { id: ret.receiptId } });
    if (receipt?.status !== 'completed') throw conflict('RECEIPT_NOT_COMPLETED', 'Phiếu nhập hàng gốc đã bị hủy');
    await applyToReceipt(tx, ret.receiptId, ret.lines, 1);
  }
  for (const l of ret.lines) {
    const r = await moveStock(tx, { productId: l.productId, branchId: ret.branchId, qty: -l.qty * l.conversion, docType: 'purchaseReturn', docId: ret.id, docCode: ret.code });
    await tx.purchaseReturnLine.update({ where: { id: l.id }, data: { cost: r.unitCost } });
  }
  await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: ret.supplierId, amount: -ret.total, docType: 'purchaseReturn', docId: ret.id, docCode: ret.code });
  if (ret.refund > 0) {
    await recordCash(tx, ctx, { kind: 'in', amount: ret.refund, fundId: ret.fundId, categoryName: 'Thu tiền NCC hoàn trả', counterpartyType: 'supplier', counterpartyId: supplier.id, counterpartyName: supplier.name, sourceType: 'purchaseReturn', sourceId: ret.id, sourceCode: ret.code, codePrefix: 'TTTHN', note: `NCC hoàn tiền phiếu ${ret.code}` });
    await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: ret.supplierId, amount: ret.refund, docType: 'purchaseReturnRefund', docId: ret.id, docCode: ret.code });
  }
  await transition(tx, 'purchaseReturn', id, ['draft'], 'completed', { completedAt: new Date() });
  await audit(tx, ctx, { action: 'complete', entity: 'PurchaseReturn', entityId: id, entityCode: ret.code, summary: `Hoàn thành trả hàng nhập ${ret.code}: ${ret.total.toLocaleString('en-US')}` });
}

export async function cancelPurchaseReturn(tx: Tx, ctx: DocCtx, id: number) {
  const ret = await tx.purchaseReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!ret || ret.branchId !== ctx.branchId) throw notFound('Phiếu trả hàng nhập');
  if (ret.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
  if (ret.status === 'completed') {
    await reverseDocument(tx, 'purchaseReturn', id, 'purchaseReturn_cancel');
    await reversePartnerDocument(tx, 'purchaseReturn', id, 'purchaseReturn_cancel');
    await reversePartnerDocument(tx, 'purchaseReturnRefund', id, 'purchaseReturnRefund_cancel');
    await cancelCashBySource(tx, ctx, 'purchaseReturn', id);
    if (ret.receiptId) await applyToReceipt(tx, ret.receiptId, ret.lines, -1);
  }
  await transition(tx, 'purchaseReturn', id, [ret.status], 'cancelled');
  await audit(tx, ctx, { action: 'cancel', entity: 'PurchaseReturn', entityId: id, entityCode: ret.code, summary: `Hủy phiếu trả hàng nhập ${ret.code}` });
}
