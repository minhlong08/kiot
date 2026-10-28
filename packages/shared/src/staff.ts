import { z } from 'zod';

const TZ_MS = 7 * 3600_000;
export const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** A shift on a local calendar day as UTC instants; a shift ending at or before its start ends the next day. */
export function shiftWindow(date: string, shift: { start: string; end: string }) {
  const day = Date.parse(`${date}T00:00:00Z`) - TZ_MS;
  const s = minutesOf(shift.start), e = minutesOf(shift.end);
  return { start: new Date(day + s * 60_000), end: new Date(day + (e <= s ? e + 1440 : e) * 60_000) };
}

export type AttendanceRules = { lateGraceMinutes: number; earlyGraceMinutes: number; overtimeAfterMinutes: number };

/**
 * Minutes for one shift: late/early beyond the grace, overtime past `end + overtimeAfter`,
 * worked = time inside the shift − break + paid overtime. Missing punches count nothing.
 */
export function attendance(w: { start: Date; end: Date }, breakMinutes: number, checkIn: Date | null, checkOut: Date | null, r: AttendanceRules) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return { worked: 0, late: 0, early: 0, overtime: 0 };
  const min = (ms: number) => Math.floor(ms / 60_000);
  const lateRaw = min(checkIn.getTime() - w.start.getTime());
  const earlyRaw = min(w.end.getTime() - checkOut.getTime());
  const late = lateRaw > r.lateGraceMinutes ? lateRaw - r.lateGraceMinutes : 0;
  const early = earlyRaw > r.earlyGraceMinutes ? earlyRaw - r.earlyGraceMinutes : 0;
  const overtime = Math.max(0, min(checkOut.getTime() - w.end.getTime()) - r.overtimeAfterMinutes);
  const inside = Math.max(0, min(Math.min(checkOut.getTime(), w.end.getTime()) - Math.max(checkIn.getTime(), w.start.getTime())));
  return { worked: Math.max(0, inside - breakMinutes) + overtime, late, early, overtime };
}

export const allowanceSchema = z.object({ name: z.string().trim().min(1).max(80), amount: z.number().int().min(0).max(1_000_000_000), per: z.enum(['month', 'shift']) });
export const deductionSchema = z.object({ name: z.string().trim().min(1).max(80), amount: z.number().int().min(0).max(1_000_000_000), per: z.enum(['month', 'late']) });
export const salaryTemplateInputSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên mẫu lương').max(120),
  mode: z.enum(['monthly', 'perShift', 'perHour']),
  amount: z.number().int().min(1, 'Mức lương phải lớn hơn 0').max(1_000_000_000),
  overtimeRate: z.number().int().min(0).max(500).default(150),
  allowances: z.array(allowanceSchema).max(20).default([]),
  deductions: z.array(deductionSchema).max(20).default([]),
  isActive: z.boolean().default(true),
});
export type SalaryTemplateInput = z.infer<typeof salaryTemplateInputSchema>;

export const commissionRuleSchema = z.object({ scope: z.enum(['all', 'group', 'product']), refId: z.number().int().nullable(), type: z.enum(['percent', 'fixed']), value: z.number().min(0).max(100_000_000) })
  .refine(r => r.scope === 'all' || r.refId !== null, 'Chọn nhóm hàng hoặc hàng hóa').refine(r => r.type !== 'percent' || r.value <= 100, 'Tỷ lệ tối đa 100%');
export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export const commissionTableInputSchema = z.object({ name: z.string().trim().min(1, 'Nhập tên bảng hoa hồng').max(120), rules: z.array(commissionRuleSchema).max(500).default([]), isActive: z.boolean().default(true) });

/** Commission on net sales lines: the most specific rule per line (product > group > all); fixed is per unit. */
export function commissionFor(lines: { productId: number; groupId: number | null; qty: number; amount: number }[], rules: CommissionRule[]): number {
  let total = 0;
  for (const l of lines) {
    const rule = rules.find(r => r.scope === 'product' && r.refId === l.productId)
      ?? rules.find(r => r.scope === 'group' && l.groupId !== null && r.refId === l.groupId)
      ?? rules.find(r => r.scope === 'all');
    if (!rule) continue;
    total += rule.type === 'percent' ? Math.round((l.amount * rule.value) / 100) : Math.round(l.qty * rule.value);
  }
  return total;
}

export type AttendanceSummary = { presentShifts: number; paidLeaveShifts: number; workedMinutes: number; overtimeMinutes: number; lateCount: number };
export type PaysheetInput = { template: Omit<SalaryTemplateInput, 'name' | 'isActive'>; attendance: AttendanceSummary; standardDays: number; commission: number; bonus: number };

export function computePaysheet(p: PaysheetInput) {
  const { template: t, attendance: a } = p;
  const paidShifts = a.presentShifts + a.paidLeaveShifts;
  const hourly = t.mode === 'perHour' ? t.amount : t.mode === 'perShift' ? t.amount / 8 : t.amount / p.standardDays / 8;
  const base = Math.round(t.mode === 'monthly' ? (t.amount * Math.min(paidShifts, p.standardDays)) / p.standardDays : t.mode === 'perShift' ? t.amount * paidShifts : (t.amount * (a.workedMinutes - a.overtimeMinutes)) / 60);
  const overtime = Math.round((hourly * a.overtimeMinutes * t.overtimeRate) / 60 / 100);
  const lines: { label: string; amount: number }[] = [{ label: 'Lương chính', amount: base }];
  if (overtime) lines.push({ label: 'Làm thêm giờ', amount: overtime });
  let allowance = 0, deduction = 0;
  for (const x of t.allowances) { const v = x.per === 'shift' ? x.amount * a.presentShifts : x.amount; allowance += v; if (v) lines.push({ label: x.name, amount: v }); }
  for (const x of t.deductions) { const v = x.per === 'late' ? x.amount * a.lateCount : x.amount; deduction += v; if (v) lines.push({ label: x.name, amount: -v }); }
  if (p.commission) lines.push({ label: 'Hoa hồng', amount: p.commission });
  if (p.bonus) lines.push({ label: 'Thưởng', amount: p.bonus });
  const total = Math.max(0, base + overtime + allowance - deduction + p.commission + p.bonus);
  return { base, overtime, allowance, deduction, commission: p.commission, bonus: p.bonus, total, lines };
}

export const employeeInputSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhân viên').max(120), phone: z.string().trim().max(20).default(''), email: z.string().trim().max(120).default(''),
  branchId: z.number().int(), position: z.string().trim().max(80).default(''), userId: z.number().int().nullable().default(null),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), idNumber: z.string().trim().max(20).default(''), address: z.string().trim().max(300).default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), salaryTemplateId: z.number().int().nullable().default(null),
  commissionTableId: z.number().int().nullable().default(null), note: z.string().max(500).default(''), isActive: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export const shiftInputSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên ca').max(60), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:mm'), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:mm'),
  breakMinutes: z.number().int().min(0).max(240).default(0), color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#0f766e'), isActive: z.boolean().default(true),
});
