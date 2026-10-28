import { expect, test } from 'vitest';
import { weightedAverageCost, applyPriceFormula, variantCombos, productInputSchema } from '../src';

test('weighted average of two receipts', () => expect(weightedAverageCost(10, 100_000, 10, 120_000)).toBe(110_000));
test('first receipt sets cost', () => expect(weightedAverageCost(0, 0, 5, 83_000)).toBe(83_000));
test('negative stock is treated as zero', () => expect(weightedAverageCost(-2, 90_000, 4, 100_000)).toBe(100_000));
test('no inbound keeps cost', () => expect(weightedAverageCost(3, 100_000, 0, 0)).toBe(100_000));
test('rounds half up to whole dong', () => expect(weightedAverageCost(1, 1, 2, 2)).toBe(2));

test('formula cost + 30% rounded to thousand', () => expect(applyPriceFormula(820_000, '+', 30, '%', 1000)).toBe(1_066_000));
test('formula never goes below zero', () => expect(applyPriceFormula(100_000, '-', 150_000, 'VND')).toBe(0));
test('formula rounds to hundred', () => expect(applyPriceFormula(123_456, '+', 0, 'VND', 100)).toBe(123_500));

test('variant combinations are the cartesian product', () => {
  expect(variantCombos([{ name: 'Màu', values: ['Đen', 'Xám'] }, { name: 'Size', values: ['M', 'L'] }]))
    .toEqual([['Đen', 'M'], ['Đen', 'L'], ['Xám', 'M'], ['Xám', 'L']]);
});
test('no attributes means no variants', () => expect(variantCombos([])).toEqual([]));

test('combo requires at least one component', () => {
  expect(productInputSchema.safeParse({ name: 'X', type: 'combo', groupId: 1, comboItems: [] }).success).toBe(false);
});
test('goods require a group', () => {
  const r = productInputSchema.safeParse({ name: 'X', type: 'goods' });
  expect(r.success).toBe(false);
});
test('service needs no group and defaults apply', () => {
  const r = productInputSchema.parse({ name: 'Sửa đồ', type: 'service' });
  expect(r.isDirectSale).toBe(true);
  expect(r.maxStock).toBe(999_999_999);
});
test('name is required with a Vietnamese message', () => {
  const r = productInputSchema.safeParse({ name: ' ', type: 'service' });
  expect(r.success).toBe(false);
  expect(JSON.stringify(r.error)).toContain('Tên hàng là bắt buộc');
});
