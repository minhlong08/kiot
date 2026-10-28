import { computeSale, type PaymentMethod, type SaleResult } from '@pd/shared';
import type { Cart } from '../state/carts';
import type { Bootstrap, PosCustomer } from './types';

export type Payment = { method: PaymentMethod; amount: number; fundId: number | null };

/** The exact same math the server runs, so the cashier sees the final numbers before paying. */
export function previewSale(cart: Cart, boot: Bootstrap, customer: PosCustomer | null, payments: Payment[], exchangeCredit = 0): SaleResult {
  const s = boot.settings;
  return computeSale({
    lines: cart.lines.map(l => ({ key: l.key, productId: l.productId, unitId: l.unitId, conversion: l.conversion, groupId: l.groupId, qty: l.qty, price: l.price, discount: l.discount, loyaltyEnabled: l.loyaltyEnabled, fixedPoints: l.fixedPoints })),
    invoiceDiscount: cart.invoiceDiscount, voucherDiscount: cart.voucherDiscount, pointsUsed: cart.pointsUsed, otherIncome: cart.otherIncome,
    payments: [...payments, ...(exchangeCredit ? [{ method: 'exchange' as const, amount: exchangeCredit }] : [])], hasCustomer: !!customer,
  }, {
    promotions: boot.promotions, promoCtx: { at: new Date(), branchId: boot.branch.id, customerGroupId: customer?.groupId ?? null },
    pointValueVnd: s.customers.pointValueVnd, vndPerPoint: s.customers.vndPerPoint, rounding: s.orders.rounding, loyaltyEnabled: s.customers.loyaltyEnabled,
  });
}

export function toInvoiceInput(cart: Cart, payments: Payment[]) {
  return {
    customerId: cart.customerId, priceBookId: cart.priceBookId, sellerId: cart.sellerId, channel: cart.channel, orderId: cart.orderId,
    lines: cart.lines.map(l => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, price: l.price, discount: l.discount, note: l.note, isGift: false })),
    invoiceDiscount: cart.invoiceDiscount, voucherCode: cart.voucherCode || undefined, pointsUsed: cart.pointsUsed, otherIncome: cart.otherIncome, note: cart.note,
    payments: payments.filter(p => p.amount > 0), delivery: cart.mode === 'delivery' ? cart.delivery : null,
  };
}
