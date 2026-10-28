import { attendance, shiftWindow, type AttendanceRules } from '@pd/shared';
import type { Tx } from '../db';

type Shift = { start: string; end: string; breakMinutes: number };

/** Minutes for a timesheet row; "present" without punches counts as the full shift worked. */
export function rowMinutes(shift: Shift, date: string, status: string, checkIn: Date | null, checkOut: Date | null, rules: AttendanceRules) {
  if (status !== 'present') return { worked: 0, late: 0, early: 0, overtime: 0 };
  const w = shiftWindow(date, shift);
  return attendance(w, shift.breakMinutes, checkIn ?? w.start, checkOut ?? (checkIn ? null : w.end), rules);
}

export type SummaryRow = { employeeId: number; presentShifts: number; paidLeaveShifts: number; unpaidLeaveShifts: number; absentShifts: number; lateCount: number; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number; workedMinutes: number };

/** Per-employee totals over local dates [from, to]; only rows that exist (scheduled-but-unrecorded shifts count nothing). */
export async function timesheetSummary(tx: Tx, employeeIds: number[], from: string, to: string): Promise<SummaryRow[]> {
  const rows = await tx.timesheet.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } } });
  return employeeIds.map(employeeId => {
    const mine = rows.filter(r => r.employeeId === employeeId);
    const present = mine.filter(r => r.status === 'present');
    return {
      employeeId, presentShifts: present.length, paidLeaveShifts: mine.filter(r => r.status === 'paidLeave').length,
      unpaidLeaveShifts: mine.filter(r => r.status === 'unpaidLeave').length, absentShifts: mine.filter(r => r.status === 'absent').length,
      lateCount: present.filter(r => r.late > 0).length, lateMinutes: present.reduce((s, r) => s + r.late, 0), earlyMinutes: present.reduce((s, r) => s + r.early, 0),
      overtimeMinutes: present.reduce((s, r) => s + r.overtime, 0), workedMinutes: present.reduce((s, r) => s + r.worked, 0),
    };
  });
}
