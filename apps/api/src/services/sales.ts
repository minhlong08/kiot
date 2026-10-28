import { computeSale, discountLimitExceeded, type InvoiceInput, type SaleLineInput } from '@pd/shared';
import type { Tx } from '../db';
import type { AuthUser } from '../plugins/auth';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from './audit';
import { getSettings } from './settings';
import { moveStock, reverseDocument } from './stock';
import { postPartnerLedger, reversePartnerDocument } from './partnerLedger';
import { postLoyalty, reverseLoyaltyDocument } from './loyalty';
import { cancelCashBySource, recordCash } from './cash';
import { activePromotions, checkVoucher, redeemVoucher, releaseVoucher } from './promotions';
import { bookApplies } from './priceBooks';
import { autoAssignGroup } from './customers';
import { isVariantMaster } from './products';
import { transition } from './transition';
import type { DocCtx } from './stockDocs';

const forbidden = (code: string, message: string) => new AppError(409, code, message);

/** Server-side price for a line: unit price, price-book price or the base price. */
async function expectedPrices(tx: Tx, input: InvoiceInput, branchId: number, userId: number, customerGroupId: number | null) {
  const productIds = input.lines.map(l => l.productId);
  const [products, units] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds } } }),
    tx.productUnit.findMany({ where: { id: { in: input.lines.map(l => l.unitId).filter((v): v is number => !!v) } } }),
  ]);
  let bookItems = new Map<number, number>();
  if (input.priceBookId) {
    const book = await tx.priceBook.findUnique({ where: { id: input.priceBookId } });
    if (!book || !bookApplies(book, { branchId, userId, customerGroupId, at: new Date() })) throw badRequest('PRICE_BOOK_NOT_APPLICABLE', 'Bảng giá không áp dụng cho giao dịch này');
    bookItems = new Map((await tx.priceBookItem.findMany({ where: { priceBookId: book.id, productId: { in: productIds } } })).map(i => [i.productId, i.price]));
  }
  const allowed = await tx.productBranch.findMany({ where: { productId: { in: productIds } } });
  return input.lines.map(l => {
    const p = products.find(x => x.id === l.productId);
    if (!p || !p.isActive || isVariantMaster(p)) throw notFound('Hàng hóa');
    if (!p.allBranches && !allowed.some(a => a.productId === p.id && a.branchId === branchId)) throw badRequest('NOT_SOLD_HERE', `${p.code} không kinh doanh tại chi nhánh này`);
    const unit = l.unitId ? units.find(u => u.id === l.unitId) : null;
    if (l.unitId && (!unit || unit.productId !== p.id)) throw badRequest('INVALID_UNIT', `Đơn vị tính không thuộc hàng ${p.code}`);
    return { product: p, conversion: unit?.conversion ?? 1, price: unit ? unit.price : bookItems.get(p.id) ?? p.price };
  });
}

export async function createInvoice(tx: Tx, ctx: DocCtx, input: InvoiceInput, user: AuthUser) {
  if (input.clientUuid) {
    const existing = await tx.invoice.findUnique({ where: { clientUuid: input.clientUuid } });
    if (existing) return existing;
  }
  const settings = await getSettings(tx);
  const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : null;
  if (input.customerId && (!customer || !customer.isActive)) throw notFound('Khách hàng');
  if (settings.orders.requireCustomer && !customer) throw badRequest('CUSTOMER_REQUIRED', 'Vui lòng chọn khách hàng');
  const group = customer?.groupId ? await tx.customerGroup.findUnique({ where: { id: customer.groupId } }) : null;
  const canEditPrice = user.isAdmin || user.permissions.has('pos.editPrice');

  const sold = input.lines.filter(l => !l.isGift);
  const expected = await expectedPrices(tx, { ...input, lines: sold }, ctx.branchId, user.id, customer?.groupId ?? null);
  const lines: (SaleLineInput & { note: string })[] = sold.map((l, i) => {
    if (l.price !== expected[i].price && !canEditPrice) throw forbidden('PRICE_NOT_ALLOWED', `Bạn không được sửa giá bán ${expected[i].product.code}`);
    return {
      key: String(i), productId: l.productId, unitId: l.unitId, conversion: expected[i].conversion, groupId: expected[i].product.groupId, qty: l.qty,
      price: l.price, discount: Math.min(l.discount, l.qty * l.price), loyaltyEnabled: expected[i].product.loyaltyEnabled, fixedPoints: expected[i].product.points, note: l.note,
    };
  });

  const at = input.createdAtClient && new Date(input.createdAtClient) < new Date() ? new Date(input.createdAtClient) : undefined;
  const promotions = await activePromotions(tx, { branchId: ctx.branchId, customerGroupId: customer?.groupId ?? null, at });
  const saleCtx = {
    promotions, promoCtx: { at: at ?? new Date(), branchId: ctx.branchId, customerGroupId: customer?.groupId ?? null },
    pointValueVnd: settings.customers.pointValueVnd, vndPerPoint: settings.customers.vndPerPoint, rounding: settings.orders.rounding, loyaltyEnabled: settings.customers.loyaltyEnabled,
  };
  const saleInput = { lines, invoiceDiscount: input.invoiceDiscount, voucherDiscount: 0, pointsUsed: input.pointsUsed, otherIncome: input.otherIncome, payments: input.payments, hasCustomer: !!customer };
  if (input.pointsUsed && !customer) throw badRequest('POINTS_NEED_CUSTOMER', 'Chọn khách hàng để dùng điểm');

  let voucherDiscount = 0;
  if (input.voucherCode) {
    const r0 = computeSale(saleInput, saleCtx);
    const check = await checkVoucher(tx, input.voucherCode, r0.subtotal - r0.promoInvoiceDiscount - input.invoiceDiscount);
    if (!check.valid) throw forbidden('VOUCHER_INVALID', check.reason);
    if (!check.campaign.combinable && (r0.promoInvoiceDiscount > 0 || r0.gifts.length)) throw forbidden('VOUCHER_NOT_COMBINABLE', 'Voucher không áp dụng cùng chương trình khuyến mại');
    voucherDiscount = check.discount;
  }
  const r = computeSale({ ...saleInput, voucherDiscount }, saleCtx);

  const maxPercent = user.isAdmin ? 100 : Math.max(user.maxDiscountPercent, group?.discountPercent ?? 0);
  if (discountLimitExceeded(r, maxPercent)) throw forbidden('DISCOUNT_LIMIT', `Giảm giá vượt quá mức cho phép (${maxPercent}%)`);
  if (r.nonCashOverpay) throw badRequest('OVERPAID', 'Số tiền chuyển khoản/thẻ lớn hơn số cần thanh toán');
  const isDelivery = !!input.delivery;
  const debt = isDelivery ? 0 : r.debt;
  const cod = isDelivery ? r.debt : 0;
  if (debt > 0 && !customer) throw badRequest('MUST_PAY_IN_FULL', 'Khách lẻ phải thanh toán đủ');
  if (input.payments.some(p => p.method === 'deposit') && !input.orderId) throw badRequest('DEPOSIT_NEEDS_ORDER', 'Tiền cọc chỉ dùng khi xuất hóa đơn từ đơn đặt hàng');
  if (debt > 0 && settings.customers.debtLimit > 0 && customer!.debt + debt > settings.customers.debtLimit) {
    throw forbidden('DEBT_LIMIT', `Vượt hạn mức công nợ ${settings.customers.debtLimit.toLocaleString('en-US')} đ`);
  }

  const shift = await tx.shift.findFirst({ where: { userId: user.id, branchId: ctx.branchId, closedAt: null } });
  const code = await docCode(tx, settings.orders.codePrefixes.invoice, undefined, async c => !!(await tx.invoice.findUnique({ where: { code: c } })));
  const invoice = await tx.invoice.create({
    data: {
      code, clientUuid: input.clientUuid ?? null, branchId: ctx.branchId, customerId: customer?.id ?? null, sellerId: input.sellerId ?? user.id, createdById: user.id,
      channel: input.channel, priceBookId: input.priceBookId, status: isDelivery ? 'processing' : 'completed', subtotal: r.subtotal,
      promoDiscount: r.lines.reduce((s, l) => s + l.promoDiscount, 0) + r.promoInvoiceDiscount, invoiceDiscount: r.invoiceDiscount,
      voucherCode: input.voucherCode?.toUpperCase() ?? null, voucherDiscount: r.voucherDiscount, pointsUsed: input.pointsUsed, pointsValue: r.pointsValue,
      otherIncome: r.otherIncome, roundingAdjust: r.roundingAdjust, total: r.total, paid: r.paid - r.change, change: r.change, debt, pointsEarned: r.pointsEarned,
      promotions: JSON.stringify(r.applied), isDelivery, note: input.note, orderId: input.orderId, shiftId: shift?.id ?? null,
      completedAt: isDelivery ? null : at ?? new Date(), ...(at ? { createdAt: at } : {}),
    },
  });

  // Lines (plus promotion gifts) leave stock; each stores its cost per base unit for COGS.
  const gifts = r.gifts.length ? await tx.product.findMany({ where: { id: { in: r.gifts.map(g => g.productId) } } }) : [];
  const allLines = [
    ...r.lines.map((l, i) => ({ ...l, note: lines[i].note, isGift: false })),
    ...r.gifts.map(g => ({ key: `g${g.productId}`, productId: g.productId, unitId: null, conversion: 1, groupId: null, qty: g.qty, price: 0, discount: 0, promoDiscount: 0, amount: 0, loyaltyEnabled: false, fixedPoints: null, note: 'Quà tặng khuyến mại', isGift: true })),
  ];
  let costTotal = 0;
  for (const l of allLines) {
    if (l.isGift && !gifts.some(g => g.id === l.productId)) continue;
    const moved = await moveStock(tx, { productId: l.productId, branchId: ctx.branchId, qty: -l.qty * l.conversion, docType: 'invoice', docId: invoice.id, docCode: code, at });
    costTotal += moved.unitCost * l.qty * l.conversion;
    await tx.invoiceLine.create({
      data: { invoiceId: invoice.id, productId: l.productId, unitId: l.unitId, conversion: l.conversion, qty: l.qty, price: l.price, discount: l.discount, promoDiscount: l.promoDiscount, amount: l.amount, cost: moved.unitCost, note: l.note, isGift: l.isGift },
    });
  }
  await tx.invoice.update({ where: { id: invoice.id }, data: { costTotal } });

  // Money: one cash voucher per payment method; change comes out of cash first, then out of exchange credit.
  const cashIn = input.payments.filter(p => p.method === 'cash').reduce((t, p) => t + p.amount, 0);
  const changeFromCash = Math.min(cashIn, r.change);
  let changeLeft = changeFromCash;
  for (const p of input.payments) {
    if (p.method === 'exchange' || p.method === 'deposit') await tx.invoicePayment.create({ data: { invoiceId: invoice.id, method: p.method, amount: p.amount } });
    if (p.method === 'points' || p.method === 'deposit' || p.method === 'exchange') continue;
    let amount = p.amount;
    if (p.method === 'cash') {
      const take = Math.min(changeLeft, p.amount);
      changeLeft -= take;
      amount -= take;
    }
    if (amount <= 0) continue;
    const fundId = p.fundId ?? settings.pos.defaultFundIds[p.method as 'cash' | 'transfer' | 'card' | 'ewallet'] ?? null;
    const v = await recordCash(tx, ctx, {
      kind: 'in', amount, fundId, categoryName: 'Thu tiền khách trả', counterpartyType: customer ? 'customer' : 'other', counterpartyId: customer?.id,
      counterpartyName: customer?.name ?? 'Khách lẻ', sourceType: 'invoice', sourceId: invoice.id, sourceCode: code, codePrefix: 'TTHD', note: `Thanh toán hóa đơn ${code}`, at,
    });
    await tx.invoicePayment.create({ data: { invoiceId: invoice.id, method: p.method, amount, fundId: v?.fundId ?? fundId, cashVoucherId: v?.id ?? null } });
  }
  if (r.pointsValue) await tx.invoicePayment.create({ data: { invoiceId: invoice.id, method: 'points', amount: r.pointsValue } });
  if (r.change > changeFromCash) {
    // Exchange credit larger than the new invoice: the difference is paid back from the drawer.
    await recordCash(tx, ctx, {
      kind: 'out', amount: r.change - changeFromCash, categoryName: 'Chi tiền trả khách', counterpartyType: customer ? 'customer' : 'other', counterpartyId: customer?.id,
      counterpartyName: customer?.name ?? 'Khách lẻ', sourceType: 'invoice', sourceId: invoice.id, sourceCode: code, codePrefix: 'TTTH', note: `Trả lại tiền chênh lệch đổi hàng ${code}`, at,
    });
  }

  if (customer) {
    if (!isDelivery) {
      await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: r.due, docType: 'invoice', docId: invoice.id, docCode: code, at });
      // Deposits were credited to the customer when collected, so only new money reduces the debt here.
      const depositUsed = input.payments.filter(p => p.method === 'deposit').reduce((t, p) => t + p.amount, 0);
      await postPartnerLedger(tx, { partnerType: 'customer', partnerId: customer.id, amount: -(r.paid - r.change - depositUsed), docType: 'invoicePayment', docId: invoice.id, docCode: code, at });
    }
    if (input.pointsUsed) await postLoyalty(tx, { customerId: customer.id, points: -input.pointsUsed, docType: 'invoiceRedeem', docId: invoice.id, docCode: code, at });
    if (r.pointsEarned) await postLoyalty(tx, { customerId: customer.id, points: r.pointsEarned, docType: 'invoice', docId: invoice.id, docCode: code, at });
    await tx.customer.update({ where: { id: customer.id }, data: { totalSpent: { increment: r.total }, lastPurchaseAt: at ?? new Date() } });
    await autoAssignGroup(tx, customer.id);
  }
  if (input.voucherCode) await redeemVoucher(tx, input.voucherCode, invoice.id, r.subtotal - r.promoInvoiceDiscount - input.invoiceDiscount);
  if (input.delivery) await tx.invoiceDelivery.create({ data: { ...input.delivery, invoiceId: invoice.id, cod } });
  if (input.orderId) await applyInvoiceToOrder(tx, ctx, input.orderId, invoice.id);

  await audit(tx, ctx, { action: 'create', entity: 'Invoice', entityId: invoice.id, entityCode: code, summary: `Bán hàng ${code}: ${r.total.toLocaleString('en-US')}${customer ? ` - ${customer.name}` : ''}` });
  return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

/** Hook for customer orders (filled by the orders service). */
export let applyInvoiceToOrder: (tx: Tx, ctx: DocCtx, orderId: number, invoiceId: number) => Promise<void> = async () => {
  throw badRequest('ORDERS_UNAVAILABLE', 'Chức năng đặt hàng chưa sẵn sàng');
};
export function setOrderHook(fn: typeof applyInvoiceToOrder) { applyInvoiceToOrder = fn; }
export let rollbackInvoiceFromOrder: (tx: Tx, ctx: DocCtx, invoiceId: number) => Promise<void> = async () => undefined;
export function setOrderRollbackHook(fn: typeof rollbackInvoiceFromOrder) { rollbackInvoiceFromOrder = fn; }

export async function cancelInvoice(tx: Tx, ctx: DocCtx, id: number) {
  const inv = await tx.invoice.findUnique({ where: { id } });
  if (!inv || inv.branchId !== ctx.branchId) throw notFound('Hóa đơn');
  if (await tx.saleReturn.count({ where: { invoiceId: id, status: 'completed' } })) throw conflict('HAS_RETURNS', 'Hóa đơn đã có phiếu trả hàng, hãy hủy phiếu trả trước');
  await transition(tx, 'invoice', id, ['completed', 'processing', 'undeliverable'], 'cancelled', { cancelledAt: new Date() });
  await reverseDocument(tx, 'invoice', id, 'invoice_cancel');
  for (const t of ['invoice', 'invoicePayment']) await reversePartnerDocument(tx, t, id, `${t}_cancel`);
  for (const t of ['invoice', 'invoiceRedeem']) await reverseLoyaltyDocument(tx, t, id, `${t}_cancel`);
  await cancelCashBySource(tx, ctx, 'invoice', id);
  if (inv.voucherCode) await releaseVoucher(tx, inv.voucherCode, id);
  if (inv.customerId) {
    await tx.customer.update({ where: { id: inv.customerId }, data: { totalSpent: { decrement: inv.total - inv.returnedTotal } } });
    await autoAssignGroup(tx, inv.customerId);
  }
  if (inv.orderId) await rollbackInvoiceFromOrder(tx, ctx, id);
  await audit(tx, ctx, { action: 'cancel', entity: 'Invoice', entityId: id, entityCode: inv.code, summary: `Hủy hóa đơn ${inv.code}` });
}
