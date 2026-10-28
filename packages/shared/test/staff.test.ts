import { expect, test } from 'vitest';
import { attendance, commissionFor, computePaysheet, shiftWindow } from '../src/staff';

const rules = { lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeAfterMinutes: 0 };
const vn = (s: string) => new Date(`${s}+07:00`);

test('day shift 08:00–17:00 with a 60-minute break: in 08:12, out 17:45', () => {
  const w = shiftWindow('2026-10-27', { start: '08:00', end: '17:00' });
  expect(w.start.toISOString()).toBe(vn('2026-10-27T08:00:00').toISOString());
  expect(attendance(w, 60, vn('2026-10-27T08:12:00'), vn('2026-10-27T17:45:00'), { ...rules, overtimeAfterMinutes: 30 }))
    .toEqual({ worked: 483, late: 7, early: 0, overtime: 15 });
});

test('overnight shift 22:00–06:00: in 21:58, out 06:40 next day', () => {
  const w = shiftWindow('2026-10-27', { start: '22:00', end: '06:00' });
  expect(w.end.toISOString()).toBe(vn('2026-10-28T06:00:00').toISOString());
  expect(attendance(w, 0, vn('2026-10-27T21:58:00'), vn('2026-10-28T06:40:00'), { ...rules, overtimeAfterMinutes: 30 }))
    .toEqual({ worked: 490, late: 0, early: 0, overtime: 10 });
});

test('leaving early beyond the grace counts; missing punches count nothing', () => {
  const w = shiftWindow('2026-10-27', { start: '08:00', end: '14:00' });
  expect(attendance(w, 0, vn('2026-10-27T08:00:00'), vn('2026-10-27T13:40:00'), rules)).toEqual({ worked: 340, late: 0, early: 15, overtime: 0 });
  expect(attendance(w, 0, null, null, rules)).toEqual({ worked: 0, late: 0, early: 0, overtime: 0 });
});

const att = { presentShifts: 24, paidLeaveShifts: 0, workedMinutes: 24 * 8 * 60, overtimeMinutes: 0, lateCount: 0 };
test('monthly 7,800,000 with 24 paid days of 26 → 7,200,000', () => {
  const r = computePaysheet({ template: { mode: 'monthly', amount: 7_800_000, overtimeRate: 150, allowances: [], deductions: [] }, attendance: att, standardDays: 26, commission: 0, bonus: 0 });
  expect([r.base, r.total]).toEqual([7_200_000, 7_200_000]);
});

test('per hour 25,000 × 7.5 h → 187,500; overtime at 150%', () => {
  const r = computePaysheet({ template: { mode: 'perHour', amount: 25_000, overtimeRate: 150, allowances: [], deductions: [] }, attendance: { ...att, presentShifts: 1, workedMinutes: 510, overtimeMinutes: 60 }, standardDays: 26, commission: 0, bonus: 0 });
  expect([r.base, r.overtime]).toEqual([187_500, 37_500]);
});

test('allowances per month and per shift, late deduction × 3, commission and bonus add up', () => {
  const r = computePaysheet({
    template: { mode: 'perShift', amount: 200_000, overtimeRate: 100, allowances: [{ name: 'Ăn trưa', amount: 30_000, per: 'shift' }, { name: 'Xăng xe', amount: 300_000, per: 'month' }], deductions: [{ name: 'Đi muộn', amount: 50_000, per: 'late' }] },
    attendance: { ...att, presentShifts: 10, lateCount: 3 }, standardDays: 26, commission: 120_000, bonus: 100_000,
  });
  expect([r.base, r.allowance, r.deduction, r.total]).toEqual([2_000_000, 600_000, 150_000, 2_000_000 + 600_000 - 150_000 + 120_000 + 100_000]);
  expect(r.lines.map(l => l.label)).toContain('Đi muộn');
});

test('commission: product rule beats group rule beats all; fixed is per unit', () => {
  const rules = [{ scope: 'all' as const, refId: null, type: 'percent' as const, value: 2 }, { scope: 'group' as const, refId: 5, type: 'percent' as const, value: 5 }, { scope: 'product' as const, refId: 9, type: 'fixed' as const, value: 20_000 }];
  expect(commissionFor([
    { productId: 1, groupId: null, qty: 1, amount: 1_000_000 },
    { productId: 2, groupId: 5, qty: 2, amount: 400_000 },
    { productId: 9, groupId: 5, qty: 3, amount: 900_000 },
  ], rules)).toBe(20_000 + 20_000 + 60_000);
});
