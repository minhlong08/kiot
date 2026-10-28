import { expect, test } from 'vitest';
import { bucketKey, groupFacts, pctChange, previousRange, sameTimeLastMonth } from '../src/reports';

test('buckets use Vietnam time', () => {
  const t = new Date('2026-10-27T17:30:00Z'); // 00:30 on the 28th in Vietnam, a Wednesday
  expect([bucketKey(t, 'day'), bucketKey(t, 'hour'), bucketKey(t, 'weekday'), bucketKey(t, 'month')]).toEqual(['2026-10-28', '00', '3', '2026-10']);
});

test('same time last month clamps to the last day of the shorter month', () => {
  expect(sameTimeLastMonth(new Date('2026-10-31T03:00:00Z')).toISOString()).toBe('2026-09-30T03:00:00.000Z');
  expect(sameTimeLastMonth(new Date('2026-03-15T03:00:00Z')).toISOString()).toBe('2026-02-15T03:00:00.000Z');
});

test('previous range has the same length immediately before', () => {
  const r = previousRange({ from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-11T00:00:00Z') });
  expect([r.from.toISOString(), r.to.toISOString()]).toEqual(['2026-09-21T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
});

test('groupFacts sums fields per key, sorted by key', () => {
  const rows = groupFacts([{ k: 'b', revenue: 5, qty: 1 }, { k: 'a', revenue: 2, qty: 1 }, { k: 'b', revenue: -1, qty: -1 }], f => f.k, ['revenue', 'qty']);
  expect(rows).toEqual([{ key: 'a', revenue: 2, qty: 1, count: 1 }, { key: 'b', revenue: 4, qty: 0, count: 2 }]);
});

test('percent change rounds to one decimal and is null without a base', () => {
  expect([pctChange(150, 100), pctChange(90, 120), pctChange(5, 0)]).toEqual([50, -25, null]);
});
