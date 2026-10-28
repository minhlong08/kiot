import { expect, test } from 'vitest';
import { computeSale, discountLimitExceeded, netUnitPrice, type SaleContext, type SaleInput, type SaleLineInput, type Promotion } from '../src';

const ctx = (o: Partial<SaleContext> = {}): SaleContext => ({ promotions: [], promoCtx: { at: new Date('2026-10-28T05:00:00Z'), branchId: 1, customerGroupId: null }, pointValueVnd: 1000, vndPerPoint: 10_000, rounding: 'none', loyaltyEnabled: true, ...o });
const ln = (key: string, qty: number, price: number, discount = 0, o: Partial<SaleLineInput> = {}): SaleLineInput => ({ key, productId: Number(key.charCodeAt(0)), unitId: null, conversion: 1, groupId: null, qty, price, discount, loyaltyEnabled: true, fixedPoints: null, ...o });
const sale = (lines: SaleLineInput[], o: Partial<SaleInput> = {}): SaleInput => ({ lines, invoiceDiscount: 0, voucherDiscount: 0, pointsUsed: 0, otherIncome: 0, payments: [], hasCustomer: false, ...o });
const base = { combinable: false, startAt: null, endAt: null, daysOfWeek: [], hours: [], branchIds: [], customerGroupIds: [] };

test('line amounts subtract manual and promotion discounts', () => {
  const promo: Promotion = { ...base, id: 1, code: 'P', name: '-10%', type: 'productDiscount', productIds: [97], groupIds: [], minQty: 1, value: 10, unit: '%' };
  const r = computeSale(sale([ln('a', 2, 100_000, 20_000)]), ctx({ promotions: [promo] }));
  expect(r.lines[0]).toMatchObject({ promoDiscount: 18_000, amount: 162_000 });
  expect(r.subtotal).toBe(162_000);
});

test('invoice tier promotion is measured after line discounts', () => {
  const tiers: Promotion = { ...base, id: 2, code: 'T', name: 'HĐ', type: 'invoiceDiscount', tiers: [{ minTotal: 1_000_000, value: 10, unit: '%' }] };
  expect(computeSale(sale([ln('a', 1, 1_100_000, 200_000)]), ctx({ promotions: [tiers] })).promoInvoiceDiscount).toBe(0);
  expect(computeSale(sale([ln('a', 1, 1_100_000)]), ctx({ promotions: [tiers] })).promoInvoiceDiscount).toBe(110_000);
});

test('voucher, points and other income', () => {
  const r = computeSale(sale([ln('a', 1, 1_000_000)], { voucherDiscount: 50_000, pointsUsed: 100, otherIncome: 30_000, hasCustomer: true, payments: [{ method: 'cash', amount: 880_000 }] }), ctx());
  expect(r).toMatchObject({ total: 980_000, pointsValue: 100_000, due: 880_000, paid: 880_000, change: 0, debt: 0 });
});

test('rounding to the nearest thousand records the adjustment', () => {
  const r = computeSale(sale([ln('a', 1, 1_234_567)], { payments: [{ method: 'cash', amount: 2_000_000 }] }), ctx({ rounding: 'thousand' }));
  expect(r).toMatchObject({ total: 1_235_000, roundingAdjust: 433, change: 765_000 });
});

test('change comes only from cash; non-cash overpayment is flagged', () => {
  const ok = computeSale(sale([ln('a', 1, 300_000)], { payments: [{ method: 'transfer', amount: 100_000 }, { method: 'cash', amount: 500_000 }] }), ctx());
  expect(ok).toMatchObject({ change: 300_000, nonCashOverpay: false });
  const bad = computeSale(sale([ln('a', 1, 300_000)], { payments: [{ method: 'transfer', amount: 400_000 }] }), ctx());
  expect(bad.nonCashOverpay).toBe(true);
});

test('unpaid remainder is debt', () => {
  expect(computeSale(sale([ln('a', 1, 500_000)], { hasCustomer: true, payments: [{ method: 'cash', amount: 200_000 }] }), ctx()).debt).toBe(300_000);
});

test('points are earned on the amount actually paid, not on the points part', () => {
  const r = computeSale(sale([ln('a', 1, 1_000_000)], { hasCustomer: true, pointsUsed: 200, payments: [{ method: 'cash', amount: 800_000 }] }), ctx());
  expect(r.pointsEarned).toBe(80);
  expect(computeSale(sale([ln('a', 1, 1_000_000)], { payments: [{ method: 'cash', amount: 1_000_000 }] }), ctx()).pointsEarned).toBe(0);
});

test('manual discount limit counts line and invoice discounts against the list price', () => {
  const r = computeSale(sale([ln('a', 1, 1_000_000, 60_000)], { invoiceDiscount: 50_000 }), ctx());
  expect(discountLimitExceeded(r, 10)).toBe(true);
  expect(discountLimitExceeded(r, 11)).toBe(false);
});

test('gift lines are free and ignored by promotions', () => {
  const r = computeSale(sale([ln('a', 1, 500_000), ln('g', 1, 0, 0, { isGift: true })]), ctx());
  expect(r.lines[1].amount).toBe(0);
  expect(r.subtotal).toBe(500_000);
});

test('exchange credit above the new total comes back as change, like cash', () => {
  const r = computeSale(sale([ln('a', 1, 300_000)], { payments: [{ method: 'exchange', amount: 500_000 }] }), ctx());
  expect(r).toMatchObject({ paid: 500_000, change: 200_000, nonCashOverpay: false });
});

test('net unit price spreads invoice-level discounts by line value', () => {
  expect(netUnitPrice({ amount: 600_000, qty: 2 }, { subtotal: 1_000_000, total: 900_000, otherIncome: 0, roundingAdjust: 0 })).toBe(270_000);
});
