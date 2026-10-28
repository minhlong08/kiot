import { z } from 'zod';
import { moneySchema } from '@pd/shared';
import type { Tx } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { adjustCounter } from './stock';
import { postPartnerLedger } from './partnerLedger';
import { recordCash } from './cash';
import { setOrderHook, setOrderRollbackHook } from './sales';
import { transition } from './transition';
import { isVariantMaster } from './products';
import type { DocCtx } from './stockDocs';

export const orderInputSchema = z.object({
  customerId: z.number().int().nullable().default(null),
  sellerId: z.number().int().nullable().default(null),
  channel: z.string().max(40).default('store'),
  lines: z.array(z.object({ productId: z.number().int(), unitId: z.number().int().nullable().default(null), qty: z.number().int().min(1), price: moneySchema, discount: moneySchema.default(0) })).min(1, 'Chưa có hàng hóa'),
  discount: moneySchema.default(0),
  deposit: moneySchema.default(0),
  depositFundId: z.number().int().nullable().default(null),
  expectedAt: z.string().datetime({ offset: true }).nullable().default(null),
  note: z.string().max(1000).default(''),
  isDelivery: z.boolean().default(false),
  confirm: z.boolean().default(false),
});
export type OrderInput = z.infer<typeof orderInputSchema>;

async function resolve(tx: Tx, lines: OrderInput['lines']) {
  const products = await tx.product.findMany({ where: { id: { in: lines.map(l => l.productId) } } });
  const units = await tx.productUnit.findMany({ where: { id: { in: lines.map(l => l.unitId ?? 0) } } });
  return lines.map(l => {
    const p = products.find(x => x.id === l.productId);
    if (!p || !p.isActive || isVariantMaster(p)) throw notFound('Hàng hóa');
    const u = l.unitId ? units.find(x => x.id === l.unitId) : null;
    if (l.unitId && u?.productId !== p.id) throw badRequest('INVALID_UNIT', 'Đơn vị tính không hợp lệ');
    return { ...l, conversion: u?.conversion ?? 1 };
  });
}

export async function saveOrder(tx: Tx, ctx: DocCtx, input: OrderInput, id?: number) {
  const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
  if (input.customerId && !customer) throw notFound('Khách hàng');
  if (input.deposit && !customer) throw badRequest('DEPOSIT_NEEDS_CUSTOMER', 'Đặt cọc cần có khách hàng');
  const lines = await resolve(tx, input.lines);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price - l.discount, 0);
  const total = Math.max(0, subtotal - input.discount);
  if (input.deposit > total) throw badRequest('DEPOSIT_EXCEEDS', 'Tiền cọc lớn hơn giá trị đơn');
  const data = { customerId: input.customerId, sellerId: input.sellerId, channel: input.channel, subtotal, discount: input.discount, total, note: input.note, isDelivery: input.isDelivery, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null };
  let order;
  if (id) {
    const cur = await tx.customerOrder.findUnique({ where: { id } });
    if (!cur || cur.branchId !== ctx.branchId) throw notFound('Đơn đặt hàng');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được đơn tạm');
    await tx.customerOrderLine.deleteMany({ where: { orderId: id } });
    order = await tx.customerOrder.update({ where: { id }, data });
  } else {
    const prefix = (await getSettings(tx)).orders.codePrefixes.customerOrder;
    const code = await docCode(tx, prefix, undefined, async c => !!(await tx.customerOrder.findUnique({ where: { code: c } })));
    order = await tx.customerOrder.create({ data: { ...data, code, branchId: ctx.branchId, createdById: ctx.userId } });
  }
  await tx.customerOrderLine.createMany({ data: lines.map(l => ({ orderId: order.id, productId: l.productId, unitId: l.unitId, conversion: l.conversion, qty: l.qty, price: l.price, discount: l.discount })) });
  const extra = input.deposit - order.deposit;
  if (extra > 0) await addDeposit(tx, ctx, order.id, extra, input.depositFundId);
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'CustomerOrder', entityId: order.id, entityCode: order.code, summary: `${id ? 'Cập nhật' : 'Tạo'} đơn đặt hàng ${order.code}` });
  return order;
}

/** Deposit = cash in now, recorded as credit on the customer's account until an invoice uses it. */
export async function addDeposit(tx: Tx, ctx: DocCtx, orderId: number, amount: number, fundId: number | null) {
  const o = await tx.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (!o.customerId) throw badRequest('DEPOSIT_NEEDS_CUSTOMER', 'Đặt cọc cần có khách hàng');
  const c = await tx.customer.findUniqueOrThrow({ where: { id: o.customerId } });
  await recordCash(tx, ctx, { kind: 'in', amount, fundId, categoryName: 'Thu tiền khách trả', counterpartyType: 'customer', counterpartyId: c.id, counterpartyName: c.name, sourceType: 'customerOrder', sourceId: o.id, sourceCode: o.code, codePrefix: 'TTDH', note: `Đặt cọc đơn ${o.code}` });
  await postPartnerLedger(tx, { partnerType: 'customer', partnerId: c.id, amount: -amount, docType: 'orderDeposit', docId: o.id, docCode: o.code });
  await tx.customerOrder.update({ where: { id: o.id }, data: { deposit: { increment: amount }, depositFundId: fundId } });
}

export async function confirmOrder(tx: Tx, ctx: DocCtx, id: number) {
  const o = await tx.customerOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o || o.branchId !== ctx.branchId) throw notFound('Đơn đặt hàng');
  await transition(tx, 'customerOrder', id, ['draft'], 'confirmed');
  for (const l of o.lines) await adjustCounter(tx, l.productId, o.branchId, 'reserved', l.qty * l.conversion);
  await audit(tx, ctx, { action: 'complete', entity: 'CustomerOrder', entityId: id, entityCode: o.code, summary: `Xác nhận đơn đặt hàng ${o.code}` });
}

export async function cancelOrder(tx: Tx, ctx: DocCtx, id: number) {
  const o = await tx.customerOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o || o.branchId !== ctx.branchId) throw notFound('Đơn đặt hàng');
  await transition(tx, 'customerOrder', id, ['draft', 'confirmed', 'partial'], 'cancelled');
  if (o.status !== 'draft') for (const l of o.lines) await adjustCounter(tx, l.productId, o.branchId, 'reserved', -Math.max(0, l.qty - l.deliveredQty) * l.conversion);
  await audit(tx, ctx, { action: 'cancel', entity: 'CustomerOrder', entityId: id, entityCode: o.code, summary: `Hủy đơn đặt hàng ${o.code}${o.deposit - o.depositUsed > 0 ? ` (tiền cọc ${(o.deposit - o.depositUsed).toLocaleString('en-US')} giữ làm công nợ có của khách)` : ''}` });
}

async function applyDelivery(tx: Tx, orderId: number, invoiceId: number, sign: 1 | -1) {
  const o = await tx.customerOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true, payments: true } });
  const deposit = inv.payments.filter(p => p.method === 'deposit').reduce((s, p) => s + p.amount, 0);
  if (sign > 0 && deposit > o.deposit - o.depositUsed) throw conflict('DEPOSIT_EXCEEDED', 'Số tiền cọc sử dụng vượt quá tiền cọc còn lại');
  for (const il of inv.lines.filter(l => !l.isGift)) {
    const ol = o.lines.find(l => l.productId === il.productId && (l.unitId ?? null) === (il.unitId ?? null));
    if (!ol) continue;
    const delta = sign > 0 ? Math.min(il.qty, ol.qty - ol.deliveredQty) : -Math.min(il.qty, ol.deliveredQty);
    if (!delta) continue;
    ol.deliveredQty += delta;
    await tx.customerOrderLine.update({ where: { id: ol.id }, data: { deliveredQty: ol.deliveredQty } });
    await adjustCounter(tx, ol.productId, o.branchId, 'reserved', -delta * ol.conversion);
  }
  const status = o.lines.every(l => l.deliveredQty >= l.qty) ? 'completed' : o.lines.some(l => l.deliveredQty > 0) ? 'partial' : 'confirmed';
  if (sign > 0 && deposit) {
    const ok = await tx.customerOrder.updateMany({ where: { id: orderId, depositUsed: { lte: o.deposit - deposit } }, data: { depositUsed: { increment: deposit } } });
    if (ok.count !== 1) throw conflict('DEPOSIT_EXCEEDED', 'Số tiền cọc sử dụng vượt quá tiền cọc còn lại');
  } else if (deposit) {
    await tx.customerOrder.update({ where: { id: orderId }, data: { depositUsed: { decrement: deposit } } });
  }
  await tx.customerOrder.update({ where: { id: orderId }, data: { status } });
}

setOrderHook(async (tx, ctx, orderId, invoiceId) => {
  const o = await tx.customerOrder.findUnique({ where: { id: orderId } });
  if (!o || o.branchId !== ctx.branchId) throw notFound('Đơn đặt hàng');
  if (!['confirmed', 'partial'].includes(o.status)) throw conflict('ORDER_NOT_OPEN', 'Đơn đặt hàng chưa xác nhận hoặc đã kết thúc');
  await applyDelivery(tx, orderId, invoiceId, 1);
});
setOrderRollbackHook(async (tx, _ctx, invoiceId) => {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.orderId) await applyDelivery(tx, inv.orderId, invoiceId, -1);
});
