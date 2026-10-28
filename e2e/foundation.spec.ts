import { expect, test } from '@playwright/test';

test('first login forces a password change, then the shell, audit log and POS link work', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Tên đăng nhập / Điện thoại / Email').fill('admin');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('admin123');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();

  await expect(page.getByRole('heading', { name: 'Đổi mật khẩu' })).toBeVisible();
  await page.getByLabel('Mật khẩu hiện tại').fill('admin123');
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Admin@2026');
  await page.getByLabel('Nhập lại mật khẩu mới').fill('Admin@2026');
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: 'Hàng hóa' }).hover();
  await expect(page.getByRole('link', { name: 'Danh sách hàng hóa' })).toBeVisible();

  await page.goto('/settings/audit-log');
  await expect(page.getByRole('cell', { name: 'Quản trị viên đăng nhập' })).toBeVisible();

  const [pos] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Bán hàng' }).click()]);
  await pos.waitForLoadState();
  expect(pos.url()).toMatch(/\/sale\/$/);
  await expect(pos.getByText('Quản trị viên')).toBeVisible();
});
