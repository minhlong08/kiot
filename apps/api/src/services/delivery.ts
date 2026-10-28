import type { Tx } from '../db';
import { AppError, conflict, notFound } from '../lib/errors';
import { audit } from './audit';
import { recordCash } from './cash';
import { postPartnerLedger } from './partnerLedger';
import { cancelInvoice } from './sales';
import { autoIssueEInvoice } from './tax';
import type { DocCtx } from './stockDocs';

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ lấy hàng', picked: 'Đã lấy hàng', delivering: 'Đang giao', delivered: 'Giao thành công',
  failed: 'Giao thất bại', returning: 'Đang chuyển hoàn', returned: 'Đã chuyển hoàn', cancelled: 'Đã hủy',
};
/** Allowed moves; `cancelled` is reached only by cancelling the invoice. */
const NEXT: Record<string, string[]> = {
  pending: ['picked', 'delivering'], picked: ['delivering'], delivering: ['delivered', 'failed'],
  failed: ['delivering', 'returning'], returning: ['returned'],
};
/** Statuses during which goods are with the carrier: the invoice cannot simply be cancelled. */
export const IN_TRANSIT = ['delivering', 'failed', 'returning'];
export const EDITABLE = ['pending', 'picked'];

/**
 * The only writer of InvoiceDelivery.status. Each move is conditional on the current status,
 * so a double click or two tabs post COD, cash and ledger rows at most once.
 */
export async function setDeliveryStatus(tx: Tx, ctx: DocCtx, invoiceId: number, to: string, opts: { note?: string } = {}) {
  const d = await tx.invoiceDelivery.findUnique({ where: { invoiceId } });
  const inv = d && await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!d || !inv || inv.branchId !== ctx.branchId) throw notFound('Vận đơn');
  if (!NEXT[d.status]?.includes(to)) throw new AppError(409, 'BAD_TRANSITION', `Không thể chuyển từ "${DELIVERY_STATUS_LABELS[d.status]}" sang "${DELIVERY_STATUS_LABELS[to] ?? to}"`);
  const now = new Date();
  const moved = await tx.invoiceDelivery.updateMany({ where: { invoiceId, status: d.status }, data: { status: to, updatedAt: now, ...(to === 'delivered' ? { deliveredAt: now } : {}) } });
  if (moved.count !== 1) throw conflict('STATE_CHANGED', 'Vận đơn đã được cập nhật bởi thao tác khác, vui lòng tải lại');

  if (to === 'failed' || to === 'returning') await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'undeliverable' } });
  if (to === 'delivering' && inv.status === 'undeliverable') await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'processing' } });
  if (to === 'delivered') {
    await completeDelivered(tx, ctx, inv, d);
    await autoIssueEInvoice(tx, ctx, invoiceId);
  }
  if (to === 'returned') await cancelInvoice(tx, ctx, invoiceId, { fromDelivery: true });
  await audit(tx, ctx, { action: 'update', entity: 'Delivery', entityId: invoiceId, entityCode: inv.code, summary: `Vận đơn ${inv.code}: ${DELIVERY_STATUS_LABELS[d.status]} → ${DELIVERY_STATUS_LABELS[to]}${opts.note ? ` (${opts.note})` : ''}` });
  return tx.invoiceDelivery.findUniqueOrThrow({ where: { invoiceId } });
}

type Inv = NonNullable<Awaited<ReturnType<Tx['invoice']['findUnique']>>>;
type Del = NonNullable<Awaited<ReturnType<Tx['invoiceDelivery']['findUnique']>>>;

async function completeDelivered(tx: Tx, ctx: DocCtx, inv: Inv, d: Del) {
  const r = await tx.invoice.updateMany({ where: { id: inv.id, status: 'processing' }, data: { status: 'completed', completedAt: new Date() } });
  if (r.count !== 1) throw conflict('STATE_CHANGED', 'Hóa đơn đã được cập nhật bởi thao tác khác, vui lòng tải lại');
  const customer = inv.customerId ? await tx.customer.findUnique({ where: { id: inv.customerId } }) : null;
  const paidBefore = inv.paid;
  // Whoever collected it, the receiver has now paid the COD: the invoice is fully paid (returns cap refunds at `paid`).
  if (d.cod > 0) await tx.invoice.update({ where: { id: inv.id }, data: { paid: { increment: d.cod } } });
  if (d.partnerId) {
    // The carrier collected the COD and now owes it to the shop; a fee the shop pays is netted off.
    await postPartnerLedger(tx, { partnerType: 'deliveryPartner', partnerId: d.partnerId, amount: d.cod, docType: 'deliveryCod', docId: inv.id, docCode: inv.code });
    if (d.feePayer === 'shop') await postPartnerLedger(tx, { partnerType: 'deliveryPartner', partnerId: d.partnerId, amount: -d.fee, docType: 'deliveryFee', docId: inv.id, docCode: inv.code });
  } else if (d.cod > 0) {
    // Self-delivery: the shop's own courier brings the COD back as cash.
    const v = await recordCash(tx, ctx, {
      kind: 'in', amount: d.cod, fundId: null, categoryName: 'Thu tiền khách trả', counterpartyType: customer ? 'customer' : 'other', counterpartyId: customer?.id,
      counterpartyName: customer?.name ?? d.receiverName, sourceType: 'invoice', sourceId: inv.id, sourceCode: inv.code, codePrefix: 'TTHD', note: `Thu COD hóa đơn ${inv.code}`,
    });
    await tx.invoicePayment.create({ data: { invoiceId: inv.id, method: 'cash', amount: d.cod, fundId: v?.fundId ?? null, cashVoucherId: v?.id ?? null } });
  }
  if (customer) {
    // Delivery sales stay off customer debt until delivered; now the sale and everything paid for it (incl. COD) post together.
    const deposit = (await tx.invoicePayment.aggregate({ _sum: { amount: true }, where: { invoiceId: inv.id, method: 'deposit' } }))._sum.amount ?? 0;
    await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: inv.total - inv.pointsValue, docType: 'invoice', docId: inv.id, docCode: inv.code });
    await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: -(paidBefore + d.cod - deposit), docType: 'invoicePayment', docId: inv.id, docCode: inv.code });
  }
}
