import bcrypt from 'bcryptjs';
import { normalizeVi, shiftWindow } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { getSettings } from '../services/settings';
import { rowMinutes } from '../services/timesheets';
import { nextCode } from '../services/codes';
import { generatePaysheets, payPaysheet } from '../services/payroll';
import { CASHIER_PERMS } from './base';

const DAY = 86400_000;
const localDate = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

/** Two staff with logins, shifts, four weeks of schedule and timesheets, pay templates, a commission table and last month's payroll paid. */
export async function seedStaff(prisma: PrismaClient, now = new Date()) {
  if (await prisma.employee.count()) return;
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
  const ctx = { userId: admin.id, branchId: branch.id, ip: '' };
  let role = await prisma.role.findFirst({ where: { name: 'Nhân viên bán hàng' } });
  role ??= await prisma.role.create({ data: { name: 'Nhân viên bán hàng', maxDiscountPercent: 10, permissions: { create: CASHIER_PERMS.map(key => ({ key })) } } });
  const rules = (await getSettings(prisma)).staff;
  let r = 7;
  const rand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };

  await prisma.$transaction(async tx => {
    // Demo logins share one password and must change it on first sign-in, like the admin account.
    const hash = await bcrypt.hash('nhanvien123', 10);
    const people = [
      { username: 'thu.ngan', fullName: 'Lê Thị Bình', position: 'Thu ngân', phone: '0912 111 222' },
      { username: 'ban.hang', fullName: 'Trần Văn Cường', position: 'Nhân viên bán hàng', phone: '0913 333 444' },
    ];
    const morning = await tx.workShift.create({ data: { branchId: branch.id, name: 'Ca sáng', start: '08:00', end: '14:00', breakMinutes: 0, color: '#0f766e' } });
    const evening = await tx.workShift.create({ data: { branchId: branch.id, name: 'Ca chiều', start: '14:00', end: '22:00', breakMinutes: 30, color: '#b45309' } });
    const monthly = await tx.salaryTemplate.create({ data: { name: 'Lương tháng thu ngân', mode: 'monthly', amount: 7_500_000, overtimeRate: 150, allowances: JSON.stringify([{ name: 'Gửi xe', amount: 150_000, per: 'month' }]), deductions: JSON.stringify([{ name: 'Đi muộn', amount: 30_000, per: 'late' }]) } });
    const perShift = await tx.salaryTemplate.create({ data: { name: 'Lương theo ca bán hàng', mode: 'perShift', amount: 220_000, overtimeRate: 150, allowances: JSON.stringify([{ name: 'Ăn ca', amount: 25_000, per: 'shift' }]), deductions: '[]' } });
    const accessories = await tx.productGroup.findFirst({ where: { name: 'Phụ kiện Nam' } });
    const table = await tx.commissionTable.create({ data: { name: 'Hoa hồng bán hàng', rules: JSON.stringify([{ scope: 'all', refId: null, type: 'percent', value: 2 }, ...(accessories ? [{ scope: 'group', refId: accessories.id, type: 'percent', value: 5 }] : [])]) } });

    const employees = [];
    for (const [i, p] of people.entries()) {
      const u = await tx.user.create({ data: { username: p.username, fullName: p.fullName, phone: p.phone.replace(/\s/g, ''), passwordHash: hash, mustChangePassword: true, roleId: role!.id, defaultBranchId: branch.id, branchAccess: { create: [{ branchId: branch.id }] } } });
      const code = await nextCode(tx, 'NV');
      employees.push(await tx.employee.create({ data: {
        code, name: p.fullName, phone: p.phone, position: p.position, branchId: branch.id, userId: u.id, startDate: new Date(now.getTime() - 400 * DAY),
        salaryTemplateId: i === 0 ? monthly.id : perShift.id, commissionTableId: i === 1 ? table.id : null, searchText: normalizeVi(`${code} ${p.fullName} ${p.phone} ${p.position}`),
      } }));
    }
    // The sales seller of every other seeded invoice is the sales assistant (commission demo).
    const invoices = await tx.invoice.findMany({ where: { branchId: branch.id }, select: { id: true }, orderBy: { id: 'asc' } });
    await tx.invoice.updateMany({ where: { id: { in: invoices.filter((_, i) => i % 2 === 1).map(i => i.id) } }, data: { sellerId: employees[1].userId! } });

    // Nine weeks of schedule (all of last month) plus this week ahead; timesheets for past days.
    const today = localDate(now.getTime());
    for (let d = -62; d <= 6; d++) {
      const date = localDate(now.getTime() + d * DAY);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0 && d % 2) continue;
      for (const [i, e] of employees.entries()) {
        const shift = (i + Math.floor((d + 63) / 7)) % 2 ? evening : morning;
        await tx.scheduleEntry.create({ data: { employeeId: e.id, shiftId: shift.id, date } });
        if (date >= today) continue;
        const w = shiftWindow(date, shift);
        const roll = rand();
        const status = roll < 0.05 ? 'absent' : roll < 0.08 ? 'paidLeave' : 'present';
        const checkIn = status === 'present' ? new Date(w.start.getTime() + Math.floor((rand() < 0.2 ? 6 + rand() * 20 : -10 + rand() * 12)) * 60_000) : null;
        const checkOut = status === 'present' ? new Date(w.end.getTime() + Math.floor((rand() < 0.15 ? 35 + rand() * 60 : rand() * 10)) * 60_000) : null;
        await tx.timesheet.create({ data: { employeeId: e.id, shiftId: shift.id, date, status, checkIn, checkOut, ...rowMinutes(shift, date, status, checkIn, checkOut, rules) } });
      }
    }

    // Last calendar month's payroll: generated, locked and paid in cash.
    const ym = (() => { const t = new Date(now.getTime() + 7 * 3600_000); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - 1); return t.toISOString().slice(0, 7); })();
    const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    const period = await tx.payrollPeriod.create({ data: { code: await nextCode(tx, 'BL'), name: `Bảng lương tháng ${ym.slice(5)}/${ym.slice(0, 4)}`, branchId: branch.id, from: `${ym}-01`, to: `${ym}-${last}`, createdById: admin.id } });
    await generatePaysheets(tx, period.id);
    await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: 'locked', lockedAt: now } });
    for (const s of await tx.paysheet.findMany({ where: { periodId: period.id } })) if (s.total > 0) await payPaysheet(tx, ctx, s.id, s.total, null);
  }, { timeout: 60_000 });
}
