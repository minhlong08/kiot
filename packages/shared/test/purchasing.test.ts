import { expect, test } from 'vitest';
import { allocateReceiptCosts, receiptTotals, receiptLineSchema, supplierInputSchema, settingsSchema } from '../src';

test('single line without extras keeps its unit cost', () => {
  expect(allocateReceiptCosts([{ qty: 10, conversion: 1, unitCost: 100_000, discount: 0 }], 0, 0)).toEqual([{ amount: 1_000_000, baseCost: 100_000 }]);
});

test('order discount and other costs are split by line value', () => {
  expect(allocateReceiptCosts([
    { qty: 2, conversion: 1, unitCost: 100_000, discount: 0 },
    { qty: 1, conversion: 1, unitCost: 100_000, discount: 0 },
  ], 90_000, 30_000)).toEqual([{ amount: 200_000, baseCost: 80_000 }, { amount: 100_000, baseCost: 80_000 }]);
});

test('non-base unit divides cost by conversion', () => {
  expect(allocateReceiptCosts([{ qty: 1, conversion: 6, unitCost: 600_000, discount: 0 }], 0, 0)[0].baseCost).toBe(100_000);
});

test('shares sum exactly to the order discount (remainder on the last line)', () => {
  const lines = [1, 1, 1].map(() => ({ qty: 1, conversion: 1, unitCost: 100_000, discount: 0 }));
  const r = allocateReceiptCosts(lines, 100_000, 0);
  expect(r.reduce((s, l) => s + l.baseCost, 0)).toBe(200_000);
});

test('zero-value lines do not divide by zero', () => {
  expect(allocateReceiptCosts([{ qty: 1, conversion: 1, unitCost: 0, discount: 0 }], 0, 10_000)).toEqual([{ amount: 0, baseCost: 10_000 }]);
});

test('totals', () => {
  expect(receiptTotals([{ qty: 2, conversion: 1, unitCost: 100_000, discount: 10_000 }], 5_000, 20_000)).toEqual({ subtotal: 190_000, total: 205_000 });
});

test('line discount cannot exceed the line value', () => {
  expect(receiptLineSchema.safeParse({ productId: 1, qty: 1, unitCost: 1000, discount: 2000 }).success).toBe(false);
});

test('supplier requires a name and a valid email when given', () => {
  expect(supplierInputSchema.safeParse({ name: '' }).success).toBe(false);
  expect(supplierInputSchema.safeParse({ name: 'A', email: 'nope' }).success).toBe(false);
  expect(supplierInputSchema.safeParse({ name: 'A', email: '' }).success).toBe(true);
});

test('new code prefixes', () => {
  const p = settingsSchema.parse({}).orders.codePrefixes;
  expect([p.cashIn, p.cashOut, p.servicePurchase]).toEqual(['PT', 'PC', 'MDV']);
});
