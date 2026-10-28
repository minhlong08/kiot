import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test('new employee → shift by drag-and-drop → timesheet → payroll → paid into the cash book', async ({ page }) => {
  await loginAsAdmin(page);
  const api = page.request;
  const json = async (r: Awaited<ReturnType<typeof api.get>>) => { expect(r.ok(), await r.text()).toBe(true); return r.json(); };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  // Employee with a per-shift salary template.
  await page.goto('/employees');
  await page.getByRole('main').getByRole('button', { name: 'Nhân viên', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Tên nhân viên').fill('Đỗ Minh Khoa');
  await form.getByLabel('Chức danh').fill('Bán hàng');
  await form.getByLabel('Mẫu lương').selectOption({ label: 'Lương theo ca bán hàng' });
  await form.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toContainText('Đã lưu nhân viên');
  const emp = (await json(await api.get('/api/employees?search=Do Minh Khoa'))).items[0];

  // Drag "Ca sáng" onto today's cell.
  await page.goto('/work-schedule');
  await page.getByRole('button', { name: 'Kéo ca Ca sáng' }).dragTo(page.getByTestId(`cell-${emp.id}-${today}`));
  await expect(page.getByTestId(`cell-${emp.id}-${today}`)).toContainText('Ca sáng');

  // Timesheet: mark present for the whole shift.
  const shift = (await json(await api.get('/api/work-shifts'))).find((s: { name: string }) => s.name === 'Ca sáng');
  await page.goto('/timesheets');
  await page.getByTestId(`ts-${emp.id}-${shift.id}-${today}`).click();
  await page.getByRole('dialog').getByLabel('Trạng thái').selectOption('present');
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toContainText('Đã cập nhật chấm công');

  // Payroll for this month: create, lock, pay the new employee.
  await page.goto('/payroll');
  await page.getByRole('main').getByRole('button', { name: 'Bảng lương', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tạo' }).click();
  await expect(page.getByRole('status')).toContainText('Đã tạo bảng lương');
  await expect(page.getByText('Đỗ Minh Khoa')).toBeVisible();
  await page.getByRole('button', { name: 'Chốt lương' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã chốt' })).toBeVisible();
  await page.getByRole('button', { name: 'Thanh toán Đỗ Minh Khoa' }).click();
  await expect(page.getByRole('dialog').getByLabel('Số tiền trả')).toHaveValue('245,000');
  await page.getByRole('dialog').getByRole('button', { name: 'Trả lương' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã trả lương' })).toBeVisible();

  await page.goto('/cashbook');
  const row = page.getByRole('row', { name: /Chi lương/ }).filter({ hasText: 'Đỗ Minh Khoa' });
  await expect(row).toContainText('-245,000');
});
