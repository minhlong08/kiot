import { expect, type Page } from '@playwright/test';

export const ADMIN_PASSWORD = 'Admin@2026';

/** Signs in as admin; completes the forced password change on a fresh database. */
export async function loginAsAdmin(page: Page) {
  for (const password of ['admin123', ADMIN_PASSWORD]) {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập / Điện thoại / Email').fill('admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/(dashboard|change-password)$/).then(() => 'ok'),
      page.getByRole('alert').waitFor().then(() => 'fail'),
    ]);
    if (outcome === 'fail') continue;
    if (page.url().endsWith('/change-password')) {
      await page.getByLabel('Mật khẩu hiện tại').fill(password);
      await page.getByLabel('Mật khẩu mới', { exact: true }).fill(ADMIN_PASSWORD);
      await page.getByLabel('Nhập lại mật khẩu mới').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/);
    return;
  }
  throw new Error('admin login failed');
}

export async function searchProducts(page: Page, text: string) {
  await page.goto('/products');
  await page.getByRole('textbox', { name: 'Tìm kiếm' }).fill(text);
}

/** Adds a product to a document editor by searching its name and pressing Enter. */
export async function addLine(page: Page, text: string) {
  const picker = page.getByPlaceholder('Tìm hàng hóa theo mã hoặc tên (F3)');
  await picker.fill(text);
  await page.getByRole('button', { name: new RegExp(text) }).first().waitFor();
  await picker.press('Enter');
}
