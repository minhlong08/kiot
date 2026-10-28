import { expect, test } from '@playwright/test';
import { addLine, loginAsAdmin, searchProducts } from './helpers';

const NAME = 'Áo test E2E';
// Cells: select, code, image, name, price, cost, onHand(6), reserved(7)…
const ON_HAND = 6;

test('create product with stock → stock take → stock card → write-off', async ({ page }) => {
  await loginAsAdmin(page);

  // The demo catalogue is there.
  await page.goto('/products');
  await expect(page.getByText('1 - 15 trong 42 hàng hóa')).toBeVisible();

  // Create a product with opening stock 5.
  await page.getByRole('main').getByRole('button', { name: 'Tạo mới' }).last().click();
  await page.getByRole('menuitem', { name: 'Hàng hóa' }).click();
  await page.getByLabel('Tên hàng').fill(NAME);
  await page.getByLabel('Nhóm hàng').selectOption({ label: 'Thời trang Nam' });
  await page.getByLabel('Tồn kho', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await searchProducts(page, NAME);
  const row = page.getByRole('row', { name: new RegExp(NAME) });
  await expect(row.getByRole('cell').nth(ON_HAND)).toHaveText('5');

  // Stock take: actual 3, completed.
  await page.goto('/stock-takes/new');
  await addLine(page, NAME);
  await page.locator('input[aria-label^="Thực tế"]').fill('3');
  await page.getByRole('button', { name: 'Hoàn thành' }).click();
  await expect(page).toHaveURL(/\/stock-takes$/);

  // Stock card shows the −2 adjustment.
  await searchProducts(page, NAME);
  await page.getByRole('cell', { name: NAME }).click();
  await page.getByRole('tab', { name: 'Thẻ kho' }).click();
  const stockTakeRow = page.getByRole('row', { name: /Kiểm kho/ });
  await expect(stockTakeRow).toContainText('-2');

  // Write off one.
  await page.goto('/write-offs/new');
  await addLine(page, NAME);
  await page.getByLabel('Lý do hủy').fill('Hàng lỗi');
  await page.getByRole('button', { name: 'Hoàn thành' }).click();
  await expect(page).toHaveURL(/\/write-offs$/);

  await searchProducts(page, NAME);
  await expect(page.getByRole('row', { name: new RegExp(NAME) }).getByRole('cell').nth(ON_HAND)).toHaveText('2');
});
