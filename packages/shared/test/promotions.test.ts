import { expect, test } from 'vitest';
import { evaluatePromotions, promotionActive, voucherDiscount, type Promotion, type CartLine } from '../src';

const base = { combinable: false, startAt: null, endAt: null, daysOfWeek: [], hours: [], branchIds: [], customerGroupIds: [] };
const ctx = { at: new Date('2026-10-28T05:00:00Z'), branchId: 1, customerGroupId: null }; // Wed 12:00 VN
const line = (key: string, productId: number, qty: number, price: number, groupId: number | null = null): CartLine => ({ key, productId, groupId, qty, price });

const tiers: Promotion = { ...base, id: 1, code: 'KM1', name: 'Giảm theo hóa đơn', type: 'invoiceDiscount', tiers: [{ minTotal: 2_000_000, value: 5, unit: '%' }, { minTotal: 5_000_000, value: 8, unit: '%', maxDiscount: 300_000 }] };

test('invoice discount picks the highest tier reached', () => {
  expect(evaluatePromotions([line('a', 1, 1, 3_000_000)], [tiers], ctx).invoiceDiscount).toBe(150_000);
});
test('percentage tiers respect the cap', () => {
  expect(evaluatePromotions([line('a', 1, 1, 6_000_000)], [tiers], ctx).invoiceDiscount).toBe(300_000);
});
test('below every tier nothing applies', () => {
  const r = evaluatePromotions([line('a', 1, 1, 1_000_000)], [tiers], ctx);
  expect(r).toMatchObject({ invoiceDiscount: 0, applied: [] });
});
test('product discount by group with minimum quantity', () => {
  const p: Promotion = { ...base, id: 2, code: 'KM2', name: 'Phụ kiện nữ -10%', type: 'productDiscount', productIds: [], groupIds: [9], minQty: 2, value: 10, unit: '%' };
  const r = evaluatePromotions([line('a', 1, 2, 300_000, 9), line('b', 2, 1, 300_000, 9), line('c', 3, 2, 300_000, 1)], [p], ctx);
  expect(r.lineDiscounts).toEqual({ a: 60_000 });
});
test('buy 2 get 1 free within the same items: 5 ties → 1 free, the cheapest', () => {
  const p: Promotion = { ...base, id: 3, code: 'KM3', name: 'Mua 2 tặng 1', type: 'buyXGetY', buyProductIds: [1, 2], buyQty: 2, getProductIds: [1, 2], getQty: 1, getDiscountPercent: 100 };
  const r = evaluatePromotions([line('a', 1, 3, 300_000), line('b', 2, 2, 250_000)], [p], ctx);
  expect(r.lineDiscounts).toEqual({ b: 250_000 });
});
test('buy X get Y with different items discounts the get item', () => {
  const p: Promotion = { ...base, id: 4, code: 'KM4', name: 'Mua vest giảm cà vạt 50%', type: 'buyXGetY', buyProductIds: [1], buyQty: 1, getProductIds: [5], getQty: 1, getDiscountPercent: 50 };
  const r = evaluatePromotions([line('a', 1, 2, 2_000_000), line('t', 5, 3, 200_000)], [p], ctx);
  expect(r.lineDiscounts).toEqual({ t: 200_000 });
});
test('gift item when the total is reached', () => {
  const p: Promotion = { ...base, id: 5, code: 'KM5', name: 'Tặng ví', type: 'giftItem', minTotal: 1_000_000, giftProductId: 7, giftQty: 1, giftValue: 190_000 };
  expect(evaluatePromotions([line('a', 1, 1, 1_000_000)], [p], ctx).gifts).toEqual([{ productId: 7, qty: 1, promotionId: 5 }]);
});
test('two non-combinable invoice promotions: only the larger applies', () => {
  const flat: Promotion = { ...base, id: 6, code: 'KM6', name: 'Giảm 100k', type: 'invoiceDiscount', tiers: [{ minTotal: 0, value: 100_000, unit: 'VND' }] };
  const r = evaluatePromotions([line('a', 1, 1, 3_000_000)], [tiers, flat], ctx);
  expect(r.invoiceDiscount).toBe(150_000);
  expect(r.applied.map(a => a.promotionId)).toEqual([1]);
});
test('combinable invoice promotions add up', () => {
  const flat: Promotion = { ...base, combinable: true, id: 6, code: 'KM6', name: 'Giảm 100k', type: 'invoiceDiscount', tiers: [{ minTotal: 0, value: 100_000, unit: 'VND' }] };
  expect(evaluatePromotions([line('a', 1, 1, 3_000_000)], [tiers, flat], ctx).invoiceDiscount).toBe(250_000);
});
test('invoice tiers are measured after line discounts', () => {
  const p: Promotion = { ...base, id: 2, code: 'KM2', name: '-50%', type: 'productDiscount', productIds: [1], groupIds: [], minQty: 1, value: 50, unit: '%' };
  expect(evaluatePromotions([line('a', 1, 1, 3_000_000)], [p, tiers], ctx).invoiceDiscount).toBe(0);
});
test('hours, weekdays, branch and customer group scope', () => {
  expect(promotionActive({ ...tiers, hours: [[8, 21]] }, { ...ctx, at: new Date('2026-10-28T15:00:00Z') })).toBe(false); // 22:00 VN
  expect(promotionActive({ ...tiers, hours: [[8, 21]] }, ctx)).toBe(true);
  expect(promotionActive({ ...tiers, daysOfWeek: [0, 6] }, ctx)).toBe(false);
  expect(promotionActive({ ...tiers, branchIds: [2] }, ctx)).toBe(false);
  expect(promotionActive({ ...tiers, customerGroupIds: [3] }, ctx)).toBe(false);
  expect(promotionActive({ ...tiers, customerGroupIds: [3] }, { ...ctx, customerGroupId: 3 })).toBe(true);
  expect(promotionActive({ ...tiers, endAt: '2026-10-01T00:00:00Z' }, ctx)).toBe(false);
});
test('voucher discount with minimum order and cap', () => {
  expect(voucherDiscount({ value: 50_000, unit: 'VND', maxDiscount: null, minOrder: 500_000 }, 400_000)).toBe(0);
  expect(voucherDiscount({ value: 50_000, unit: 'VND', maxDiscount: null, minOrder: 500_000 }, 600_000)).toBe(50_000);
  expect(voucherDiscount({ value: 10, unit: '%', maxDiscount: 80_000, minOrder: 0 }, 1_000_000)).toBe(80_000);
  expect(voucherDiscount({ value: 100_000, unit: 'VND', maxDiscount: null, minOrder: 0 }, 60_000)).toBe(60_000);
});

test('I-1: non-combinable line promotions do not stack — the best one wins and the item is never free twice', () => {
  const half: Promotion = { ...base, id: 20, code: 'P50', name: '-50%', type: 'productDiscount', productIds: [1], groupIds: [], minQty: 1, value: 50, unit: '%' };
  const b1g1: Promotion = { ...base, id: 21, code: 'B1G1', name: 'Mua 1 tặng 1', type: 'buyXGetY', buyProductIds: [1], buyQty: 1, getProductIds: [1], getQty: 1, getDiscountPercent: 100 };
  const r = evaluatePromotions([line('a', 1, 2, 100_000)], [half, b1g1], ctx);
  expect(r.lineDiscounts.a).toBe(100_000);
  expect(r.applied).toEqual([{ promotionId: 20, name: '-50%', amount: 100_000 }]);
});

test('I-1: combinable line promotions add on top of the best one, capped at the line value', () => {
  const half: Promotion = { ...base, id: 20, code: 'P50', name: '-50%', type: 'productDiscount', productIds: [1], groupIds: [], minQty: 1, value: 50, unit: '%' };
  const extra: Promotion = { ...base, combinable: true, id: 22, code: 'X', name: '-60k', type: 'productDiscount', productIds: [1], groupIds: [], minQty: 1, value: 60_000, unit: 'VND' };
  const r = evaluatePromotions([line('a', 1, 1, 100_000)], [half, extra], ctx);
  expect(r.lineDiscounts.a).toBe(100_000);
  expect(r.applied.reduce((s, a) => s + a.amount, 0)).toBe(100_000);
});

test('I-2: invoice promotions worth nothing are not listed and applied amounts match the discount', () => {
  const p: Promotion = { ...base, id: 2, code: 'KM2', name: '-100%', type: 'productDiscount', productIds: [1], groupIds: [], minQty: 1, value: 100, unit: '%' };
  const flat: Promotion = { ...base, combinable: true, id: 6, code: 'KM6', name: 'Giảm 100k', type: 'invoiceDiscount', tiers: [{ minTotal: 0, value: 100_000, unit: 'VND' }] };
  const r = evaluatePromotions([line('a', 1, 1, 50_000)], [p, flat], ctx);
  expect(r.invoiceDiscount).toBe(0);
  expect(r.applied.map(a => a.promotionId)).toEqual([2]);
});
