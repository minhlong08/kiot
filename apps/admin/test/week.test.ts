import { expect, test } from 'vitest';
import { toInstant } from '../src/pages/staff/week';

test('overnight shift 22:00–06:00: 21:58 stays on the shift day, 06:40 is the next morning', () => {
  const s = { start: '22:00', end: '06:00' };
  expect(toInstant('2026-10-27', '21:58', s)).toBe('2026-10-27T14:58:00.000Z');
  expect(toInstant('2026-10-27', '06:40', s)).toBe('2026-10-27T23:40:00.000Z');
});

test('a day shift checked out after midnight lands on the next day; normal times stay', () => {
  const s = { start: '14:00', end: '22:00' };
  expect(toInstant('2026-10-27', '00:30', s)).toBe('2026-10-27T17:30:00.000Z');
  expect(toInstant('2026-10-27', '13:50', s)).toBe('2026-10-27T06:50:00.000Z');
});
