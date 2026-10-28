import { z } from 'zod';
import { invoiceInputSchema, moneySchema, netUnitPrice, type InvoiceInput } from '@pd/shared';
import type { Tx } from '../db';
import type { AuthUser } from '../plugins/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { getBranchStock, moveStock, reverseDocument } from './stock';
import { postPartnerLedger, reversePartnerDocument } from './partnerLedger';
import { postLoyalty, reverseLoyaltyDocument } from './loyalty';
import { cancelCashBySource, recordCash } from './cash';
import { autoAssignGroup } from './customers';
import { createInvoice } from './sales';
import { transition } from './transition';
import type { DocCtx } from './stockDocs';

export const returnInputSchema = z.object({
  invoiceId: z.number().int().nullable().default(null),
  customerId: z.number().int().nullable().default(null),
  lines: z.array(z.object({ invoiceLineId: z.number().int().optional(), productId: z.number().int().optional(), unitId: z.number().int().nullable().default(null), qty: z.number().int().min(1), price: moneySchema.optional() })).min(1, 'Chưa có hàng trả'),
  returnFee: moneySchema.default(0),
  refundMethod: z.enum(['cash', 'transfer', 'debt', 'exchange']).default('cash'),
  fundId: z.number().int().nullable().default(null),
  note: z.string().max(1000).default(''),
  exchange: invoiceInputSchema.omit({ customerId: true }).partial({ payments: true }).nullable().default(null),
});
export type ReturnInput = z.infer<typeof returnInputSchema>;

/** Lines that can still be returned from an invoice, at their net price. */
export async function returnDraft(tx: Tx, invoiceId: number, branchId: number) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lines: true } });
  if (!inv || inv.branchId !== branchId) throw notFound('Hóa đơn');
  if (inv.status !== 'completed') throw conflict('INVOICE_NOT_COMPLETED', 'Chỉ trả hàng cho hóa đơn đã hoàn thành');
  const products = await tx.product.findMany({ where: { id: { in: inv.lines.map(l => l.productId) } }, select: { id: true, code: true, name: true, unit: true } });
  const units = await tx.productUnit.findMany({ where: { id: { in: inv.lines.map(l => l.unitId ?? 0) } } });
  return {
    invoice: { id: inv.id, code: inv.code, customerId: inv.customerId, total: inv.total },
    lines: inv.lines.map(l => ({
      invoiceLineId: l.id, productId: l.productId, unitId: l.unitId, conversion: l.conversion,
      productCode: units.find(u => u.id === l.unitId)?.code ?? products.find(p => p.id === l.productId)?.code ?? '',
      productName: products.find(p => p.id === l.productId)?.name ?? '', unit: units.find(u => u.id === l.unitId)?.name ?? products.find(p => p.id === l.productId)?.unit ?? '',
      soldQty: l.qty, qty: Math.floor((l.qty * l.conversion - l.returnedQty) / l.conversion), price: l.isGift ? 0 : netUnitPrice(l, inv),
    })).filter(l => l.qty > 0),
  };
}

export async function createReturn(tx: Tx, ctx: DocCtx, input: ReturnInput, user: AuthUser) {
  const settings = await getSettings(tx);
  const inv = input.invoiceId ? await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { lines: true } }) : null;
  if (input.invoiceId && (!inv || inv.branchId !== ctx.branchId)) throw notFound('Hóa đơn');
  if (inv && inv.status !== 'completed') throw conflict('INVOICE_NOT_COMPLETED', 'Chỉ trả hàng cho hóa đơn đã hoàn thành');
  const customerId = inv?.customerId ?? input.customerId;
  const customer = customerId ? await tx.customer.findUnique({ where: { id: customerId } }) : null;
  if (input.refundMethod === 'debt' && !customer) throw badRequest('DEBT_NEEDS_CUSTOMER', 'Trả vào công nợ cần có khách hàng');

  // Resolve each returned line: from the invoice (net price, sold cost) or a quick return (given price, current cost).
  const lines: { invoiceLineId: number | null; productId: number; unitId: number | null; conversion: number; qty: number; price: number; cost: number }[] = [];
  for (const l of input.lines) {
    if (inv) {
      const il = inv.lines.find(x => x.id === l.invoiceLineId);
      if (!il) throw badRequest('INVALID_LINE', 'Dòng hàng không thuộc hóa đơn');
      if (l.qty * il.conversion > il.qty * il.conversion - il.returnedQty) throw conflict('RETURN_EXCEEDS_SALE', 'Số lượng trả vượt quá số lượng còn lại trên hóa đơn');
      lines.push({ invoiceLineId: il.id, productId: il.productId, unitId: il.unitId, conversion: il.conversion, qty: l.qty, price: il.isGift ? 0 : netUnitPrice(il, inv), cost: il.cost });
    } else {
      if (!l.productId || l.price === undefined) throw badRequest('INVALID_LINE', 'Nhập hàng hóa và giá trả');
      const unit = l.unitId ? await tx.productUnit.findUnique({ where: { id: l.unitId } }) : null;
      if (l.unitId && unit?.productId !== l.productId) throw badRequest('INVALID_UNIT', 'Đơn vị tính không hợp lệ');
      const product = await tx.product.findUnique({ where: { id: l.productId } });
      if (!product) throw notFound('Hàng hóa');
      const cost = (await getBranchStock(tx, l.productId, ctx.branchId)).cost || product.cost;
      lines.push({ invoiceLineId: null, productId: l.productId, unitId: l.unitId, conversion: unit?.conversion ?? 1, qty: l.qty, price: l.price, cost });
    }
  }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  if (input.returnFee > subtotal) throw badRequest('FEE_EXCEEDS', 'Phí trả hàng lớn hơn giá trị hàng trả');
  const total = subtotal - input.returnFee;
  const code = await docCode(tx, settings.orders.codePrefixes.return, undefined, async c => !!(await tx.saleReturn.findUnique({ where: { code: c } })));
  const pointsReversed = inv && customer && inv.pointsEarned && inv.total ? Math.floor((inv.pointsEarned * total) / inv.total) : 0;
  const ret = await tx.saleReturn.create({
    data: {
      code, invoiceId: inv?.id ?? null, branchId: ctx.branchId, customerId: customer?.id ?? null, createdById: user.id, subtotal, returnFee: input.returnFee, total,
      refunded: ['cash', 'transfer'].includes(input.refundMethod) ? total : 0, toDebt: input.refundMethod === 'debt' ? total : 0, pointsReversed,
      refundMethod: input.refundMethod, fundId: input.fundId, note: input.note,
      costTotal: lines.reduce((s, l) => s + l.cost * l.qty * l.conversion, 0),
    },
  });
  for (const l of lines) {
    await moveStock(tx, { productId: l.productId, branchId: ctx.branchId, qty: l.qty * l.conversion, unitCost: l.cost, docType: 'return', docId: ret.id, docCode: code });
    await tx.saleReturnLine.create({ data: { returnId: ret.id, invoiceLineId: l.invoiceLineId, productId: l.productId, unitId: l.unitId, conversion: l.conversion, qty: l.qty, price: l.price, amount: l.qty * l.price, cost: l.cost } });
    if (l.invoiceLineId) await tx.invoiceLine.update({ where: { id: l.invoiceLineId }, data: { returnedQty: { increment: l.qty * l.conversion } } });
  }
  if (inv) await tx.invoice.update({ where: { id: inv.id }, data: { returnedTotal: { increment: total } } });

  if (input.refundMethod === 'cash' || input.refundMethod === 'transfer') {
    const fundId = input.fundId ?? settings.pos.defaultFundIds[input.refundMethod] ?? null;
    await recordCash(tx, ctx, { kind: 'out', amount: total, fundId, categoryName: 'Chi tiền trả khách', counterpartyType: customer ? 'customer' : 'other', counterpartyId: customer?.id, counterpartyName: customer?.name ?? 'Khách lẻ', sourceType: 'return', sourceId: ret.id, sourceCode: code, codePrefix: 'TTTH', note: `Trả tiền khách phiếu ${code}` });
  }
  if (customer) {
    // The return lowers what the customer owes; a cash refund then pays that credit back out.
    if (input.refundMethod !== 'exchange') {
      await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: -total, docType: 'return', docId: ret.id, docCode: code });
      if (input.refundMethod !== 'debt') await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: total, docType: 'returnRefund', docId: ret.id, docCode: code });
    }
    if (pointsReversed) await postLoyalty(tx, { customerId: customer.id, points: -pointsReversed, docType: 'return', docId: ret.id, docCode: code, allowNegative: true });
    await tx.customer.update({ where: { id: customer.id }, data: { totalSpent: { decrement: total } } });
    await autoAssignGroup(tx, customer.id);
  }

  let exchangeInvoice = null;
  if (input.refundMethod === 'exchange') {
    if (!input.exchange) throw badRequest('EXCHANGE_LINES', 'Chọn hàng đổi');
    const exchange: InvoiceInput = invoiceInputSchema.parse({ ...input.exchange, customerId: customer?.id ?? null, payments: [...(input.exchange.payments ?? []), { method: 'exchange', amount: total }] });
    exchangeInvoice = await createInvoice(tx, ctx, exchange, user);
    await tx.saleReturn.update({ where: { id: ret.id }, data: { exchangeInvoiceId: exchangeInvoice.id } });
  }
  await audit(tx, ctx, { action: 'create', entity: 'SaleReturn', entityId: ret.id, entityCode: code, summary: `Trả hàng ${code}${inv ? ` cho ${inv.code}` : ''}: ${total.toLocaleString('en-US')}` });
  return { ...(await tx.saleReturn.findUniqueOrThrow({ where: { id: ret.id } })), exchangeInvoice };
}

export async function cancelReturn(tx: Tx, ctx: DocCtx, id: number) {
  const ret = await tx.saleReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!ret || ret.branchId !== ctx.branchId) throw notFound('Phiếu trả hàng');
  if (ret.exchangeInvoiceId) {
    const ex = await tx.invoice.findUnique({ where: { id: ret.exchangeInvoiceId } });
    if (ex && ex.status !== 'cancelled') throw conflict('HAS_EXCHANGE', 'Hãy hủy hóa đơn đổi hàng trước');
  }
  await transition(tx, 'saleReturn', id, ['completed'], 'cancelled');
  const allowNegative = (await getSettings(tx)).products.allowNegativeStock;
  await reverseDocument(tx, 'return', id, 'return_cancel', allowNegative);
  for (const t of ['return', 'returnRefund']) await reversePartnerDocument(tx, t, id, `${t}_cancel`);
  await reverseLoyaltyDocument(tx, 'return', id, 'return_cancel');
  await cancelCashBySource(tx, ctx, 'return', id);
  for (const l of ret.lines) if (l.invoiceLineId) await tx.invoiceLine.update({ where: { id: l.invoiceLineId }, data: { returnedQty: { decrement: l.qty * l.conversion } } });
  if (ret.invoiceId) await tx.invoice.update({ where: { id: ret.invoiceId }, data: { returnedTotal: { decrement: ret.total } } });
  if (ret.customerId) {
    await tx.customer.update({ where: { id: ret.customerId }, data: { totalSpent: { increment: ret.total } } });
    await autoAssignGroup(tx, ret.customerId);
  }
  await audit(tx, ctx, { action: 'cancel', entity: 'SaleReturn', entityId: id, entityCode: ret.code, summary: `Hủy phiếu trả hàng ${ret.code}` });
}
