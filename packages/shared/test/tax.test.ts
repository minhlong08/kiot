import { expect, test } from 'vitest';
import { householdTax, vatBreakdown } from '../src/tax';

test('prices include VAT: 1,080,000 at 8% is 1,000,000 net + 80,000 VAT', () => {
  expect(vatBreakdown([{ amount: 1_080_000, vatRate: 8 }])).toEqual([{ rate: 8, gross: 1_080_000, net: 1_000_000, vat: 80_000 }]);
});

test('lines group by rate, sorted; negative amounts (returns) net off', () => {
  expect(vatBreakdown([{ amount: 220_000, vatRate: 10 }, { amount: 540_000, vatRate: 8 }, { amount: 540_000, vatRate: 8 }, { amount: -110_000, vatRate: 10 }, { amount: 50_000, vatRate: 0 }])).toEqual([
    { rate: 0, gross: 50_000, net: 50_000, vat: 0 },
    { rate: 8, gross: 1_080_000, net: 1_000_000, vat: 80_000 },
    { rate: 10, gross: 110_000, net: 100_000, vat: 10_000 },
  ]);
});

test('household tax is revenue × (VAT% + PIT%), rounded', () => {
  expect(householdTax(100_000_000, 1, 0.5)).toEqual({ revenue: 100_000_000, vat: 1_000_000, pit: 500_000, total: 1_500_000 });
});
