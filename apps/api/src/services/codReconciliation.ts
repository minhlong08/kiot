import type { Tx } from '../db';
import { conflict, notFound } from '../lib/errors';
import { audit } from './audit';
import { recordCash } from './cash';
import { nextCode } from './codes';
import { postPartnerLedger, reversePartnerDocument } from './partnerLedger';
import type { DocCtx } from './stockDocs';

export type ReconcileInput = { partnerId: number; invoiceIds: number[]; fundId: number | null; note: string };

/**
 * Settles delivered waybills with their carrier: one cash voucher for Σcod − Σ(shop-paid fees),
 * the partner's balance reduced by the same amount. Waybills are claimed conditionally, so none can be settled twice.
 */
export async function reconcileCod(tx: Tx, ctx: DocCtx, input: ReconcileInput) {
  const partner = await tx.deliveryPartner.findUnique({ where: { id: input.partnerId } });
  if (!partner) throw notFound('Đối tác giao hàng');
  const ids = [...new Set(input.invoiceIds)];
  const branchInvoices = await tx.invoice.findMany({ where: { id: { in: ids }, branchId: ctx.branchId }, select: { id: true, code: true } });
  const ds = await tx.invoiceDelivery.findMany({ where: { invoiceId: { in: branchInvoices.map(i => i.id) }, partnerId: partner.id, status: 'delivered', reconciledAt: null } });
  if (ds.length !== ids.length) throw conflict('NOT_RECONCILABLE', 'Có vận đơn chưa giao thành công, đã đối soát hoặc thuộc đối tác khác');
  const codTotal = ds.reduce((s, d) => s + d.cod, 0);
  const feeTotal = ds.filter(d => d.feePayer === 'shop').reduce((s, d) => s + d.fee, 0);
  const amount = codTotal - feeTotal;
  const code = await nextCode(tx, 'DSCOD');
  const rec = await tx.codReconciliation.create({ data: { code, partnerId: partner.id, branchId: ctx.branchId, amount, codTotal, feeTotal, fundId: input.fundId ?? 0, note: input.note, createdById: ctx.userId } });
  const claimed = await tx.invoiceDelivery.updateMany({ where: { invoiceId: { in: ds.map(d => d.invoiceId) }, reconciledAt: null }, data: { reconciledAt: new Date(), reconciliationId: rec.id } });
  if (claimed.count !== ds.length) throw conflict('NOT_RECONCILABLE', 'Vận đơn vừa được đối soát bởi thao tác khác');
  const v = amount === 0 ? null : await recordCash(tx, ctx, {
    kind: amount > 0 ? 'in' : 'out', amount: Math.abs(amount), fundId: input.fundId, categoryName: amount > 0 ? 'Thu tiền đối tác giao hàng' : 'Chi tiền trả đối tác giao hàng',
    counterpartyType: 'other', counterpartyName: partner.name, sourceType: 'codReconciliation', sourceId: rec.id, sourceCode: code, codePrefix: 'DSCOD', code, note: `Đối soát COD ${ds.length} vận đơn`,
  });
  await postPartnerLedger(tx, { partnerType: 'deliveryPartner', partnerId: partner.id, amount: -amount, docType: 'codReconciliation', docId: rec.id, docCode: code });
  await audit(tx, ctx, { action: 'create', entity: 'CodReconciliation', entityId: rec.id, entityCode: code, summary: `Đối soát COD ${partner.name}: ${amount.toLocaleString('en-US')}` });
  return tx.codReconciliation.update({ where: { id: rec.id }, data: { cashVoucherId: v?.id ?? null, fundId: v?.fundId ?? rec.fundId } });
}

export async function cancelCodReconciliation(tx: Tx, ctx: DocCtx, id: number) {
  const rec = await tx.codReconciliation.findUnique({ where: { id } });
  if (!rec || rec.branchId !== ctx.branchId) throw notFound('Phiếu đối soát');
  const r = await tx.codReconciliation.updateMany({ where: { id, status: 'completed' }, data: { status: 'cancelled', cancelledAt: new Date() } });
  if (!r.count) throw conflict('ALREADY_CANCELLED', 'Phiếu đối soát đã hủy');
  if (rec.cashVoucherId) await tx.cashVoucher.update({ where: { id: rec.cashVoucherId }, data: { status: 'cancelled' } });
  await reversePartnerDocument(tx, 'codReconciliation', id, 'codReconciliation_cancel');
  await tx.invoiceDelivery.updateMany({ where: { reconciliationId: id }, data: { reconciledAt: null, reconciliationId: null } });
  await audit(tx, ctx, { action: 'cancel', entity: 'CodReconciliation', entityId: id, entityCode: rec.code, summary: `Hủy đối soát ${rec.code}` });
}
