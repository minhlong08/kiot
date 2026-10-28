import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

const NAME = 'Khách E2E Trùng SĐT';
// Cells: code, name, phone, group, debt(4)…
const DEBT = 4;

test('duplicate phone confirm, collect a debt, create a running promotion', async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto('/customers');
  await page.getByRole('button', { name: 'Khách hàng' }).last().click();
  await page.getByLabel('Tên khách hàng').fill(NAME);
  await page.getByLabel('Điện thoại', { exact: true }).fill('0903111222');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText(/Số điện thoại đã dùng cho khách KH000001/)).toBeVisible();
  await page.getByRole('button', { name: 'Vẫn lưu' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Tìm kiếm' }).fill('Trung SDT');
  await page.getByRole('cell', { name: NAME }).click();
  await page.getByRole('tab', { name: 'Nợ cần thu từ khách' }).click();
  await page.getByRole('button', { name: 'Điều chỉnh', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').first().fill('250,000');
  await page.getByLabel('Lý do điều chỉnh').fill('Nợ cũ chuyển sang');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  const row = page.getByRole('row', { name: new RegExp(NAME) });
  await expect(row.getByRole('cell').nth(DEBT)).toHaveText('250,000');

  // The row stays expanded on the debt tab after the adjustment.
  await page.getByRole('button', { name: 'Thu tiền' }).click();
  await expect(page.getByLabel('Số tiền thu')).toHaveValue('250,000');
  await page.getByRole('button', { name: 'Tạo phiếu thu' }).click();
  await expect(row.getByRole('cell').nth(DEBT)).toHaveText('0');

  await page.goto('/promotions');
  await page.getByRole('main').getByRole('button', { name: 'Khuyến mại' }).last().click();
  await page.getByLabel('Tên chương trình').fill('KM E2E hóa đơn');
  await page.getByRole('button', { name: 'Thêm mức' }).click();
  await page.getByLabel('Tổng tiền hàng từ 1').fill('1,000,000');
  await page.getByLabel('Giảm 1').fill('3');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('row', { name: /KM E2E hóa đơn/ })).toContainText('Đang chạy');
});
