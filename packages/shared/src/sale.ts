import { pointsEarned } from './loyalty';
import { evaluatePromotions, type PromoContext, type PromoResult, type Promotion } from './promotions';

export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'ewallet', 'points', 'deposit', 'exchange'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type SaleLineInput = {
  key: string; productId: number; unitId: number | null; conversion: number; groupId: number | null;
  qty: number; price: number; /** manual discount for the whole line */ discount: number;
  loyaltyEnabled: boolean; fixedPoints: number | null; isGift?: boolean;
};
export type SaleInput = {
  lines: SaleLineInput[]; invoiceDiscount: number; voucherDiscount: number; pointsUsed: number; otherIncome: number;
  payments: { method: PaymentMethod; amount: number }[]; hasCustomer: boolean;
};
export type SaleContext = {
  promotions: Promotion[]; promoCtx: PromoContext; pointValueVnd: number; vndPerPoint: number;
  rounding: 'none' | 'hundred' | 'thousand'; loyaltyEnabled: boolean;
};
export type SaleResult = {
  lines: (SaleLineInput & { promoDiscount: number; amount: number })[];
  gifts: PromoResult['gifts']; applied: PromoResult['applied'];
  subtotal: number; promoInvoiceDiscount: number; invoiceDiscount: number; voucherDiscount: number;
  pointsValue: number; otherIncome: number; roundingAdjust: number; total: number; due: number;
  paid: number; change: number; debt: number; pointsEarned: number; nonCashOverpay: boolean;
};

const roundTo = (n: number, mode: SaleContext['rounding']) => (mode === 'thousand' ? Math.round(n / 1000) * 1000 : mode === 'hundred' ? Math.round(n / 100) * 100 : Math.round(n));

/** Every money figure of a sale. Called by the POS for display and again by the API, whose result is stored. */
export function computeSale(input: SaleInput, ctx: SaleContext): SaleResult {
  const priced = input.lines.filter(l => !l.isGift);
  const promo = evaluatePromotions(
    priced.map(l => ({ key: l.key, productId: l.productId, groupId: l.groupId, qty: l.qty, price: Math.round((l.qty * l.price - l.discount) / l.qty) })),
    ctx.promotions, ctx.promoCtx,
  );
  const lines = input.lines.map(l => {
    if (l.isGift) return { ...l, price: 0, discount: 0, promoDiscount: 0, amount: 0 };
    const promoDiscount = promo.lineDiscounts[l.key] ?? 0;
    return { ...l, promoDiscount, amount: Math.max(0, l.qty * l.price - l.discount - promoDiscount) };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const raw = Math.max(0, subtotal - promo.invoiceDiscount - input.invoiceDiscount - input.voucherDiscount + input.otherIncome);
  const total = roundTo(raw, ctx.rounding);
  const pointsValue = Math.min(total, input.pointsUsed * ctx.pointValueVnd);
  const due = total - pointsValue;
  const counted = input.payments.filter(p => p.method !== 'points');
  const paid = counted.reduce((s, p) => s + p.amount, 0);
  // Change is paid from the drawer: it may come from cash or from exchange credit, never from card/transfer.
  const cash = counted.filter(p => p.method === 'cash' || p.method === 'exchange').reduce((s, p) => s + p.amount, 0);
  const over = Math.max(0, paid - due);
  const earned = input.hasCustomer && ctx.loyaltyEnabled
    ? pointsEarned(lines.filter(l => !l.isGift).map(l => ({ amount: l.amount, loyaltyEnabled: l.loyaltyEnabled, fixedPoints: l.fixedPoints, qty: l.qty })),
      promo.invoiceDiscount + input.invoiceDiscount + input.voucherDiscount, pointsValue, ctx.vndPerPoint)
    : 0;
  return {
    lines, gifts: promo.gifts, applied: promo.applied, subtotal, promoInvoiceDiscount: promo.invoiceDiscount, invoiceDiscount: input.invoiceDiscount,
    voucherDiscount: input.voucherDiscount, pointsValue, otherIncome: input.otherIncome, roundingAdjust: total - raw, total, due, paid,
    change: Math.min(cash, over), debt: Math.max(0, due - paid), pointsEarned: earned, nonCashOverpay: over > cash,
  };
}

/** Manual discounts (line + invoice) above the role's percentage of the list price. Promotions don't count. */
export function discountLimitExceeded(r: SaleResult, maxPercent: number): boolean {
  const list = r.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const manual = r.lines.reduce((s, l) => s + l.discount, 0) + r.invoiceDiscount;
  return manual * 100 > list * maxPercent;
}

/** Net unit price of a sold line after its share of invoice-level discounts (used for refunds). */
export function netUnitPrice(line: { amount: number; qty: number }, inv: { subtotal: number; total: number; otherIncome: number; roundingAdjust: number }): number {
  const invoiceLevel = inv.subtotal + inv.otherIncome + inv.roundingAdjust - inv.total;
  const share = inv.subtotal > 0 ? (invoiceLevel * line.amount) / inv.subtotal : 0;
  return Math.max(0, Math.round((line.amount - share) / line.qty));
}
