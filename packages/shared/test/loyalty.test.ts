import { expect, test } from 'vitest';
import { pointsEarned, customerInputSchema, PROVINCES } from '../src';

test('1,000,000 at 10,000 per point earns 100', () => {
  expect(pointsEarned([{ amount: 1_000_000, loyaltyEnabled: true, qty: 1 }], 0, 0, 10_000)).toBe(100);
});
test('non-loyalty lines earn nothing', () => {
  expect(pointsEarned([{ amount: 500_000, loyaltyEnabled: false, qty: 1 }], 0, 0, 10_000)).toBe(0);
});
test('invoice discount is spread by value; only the eligible share reduces points', () => {
  expect(pointsEarned([{ amount: 600_000, loyaltyEnabled: true, qty: 1 }, { amount: 400_000, loyaltyEnabled: false, qty: 1 }], 100_000, 0, 10_000)).toBe(54);
});
test('the part paid with points earns nothing', () => {
  expect(pointsEarned([{ amount: 1_000_000, loyaltyEnabled: true, qty: 1 }], 0, 200_000, 10_000)).toBe(80);
});
test('fixed points per unit', () => {
  expect(pointsEarned([{ amount: 100_000, loyaltyEnabled: true, fixedPoints: 5, qty: 2 }], 0, 0, 10_000)).toBe(10);
});
test('customer schema and provinces', () => {
  expect(customerInputSchema.safeParse({ name: '' }).success).toBe(false);
  expect(customerInputSchema.parse({ name: 'Lan', birthday: '1990-05-12' }).birthday).toBe('1990-05-12');
  expect(PROVINCES).toHaveLength(34);
  expect(PROVINCES).toContain('TP. Hồ Chí Minh');
});
