import { expect, test, type Page } from '@playwright/test';
import { addLine, loginAsAdmin, searchProducts } from './helpers';

const SUPPLIER = 'Công ty TNHH May Việt Tiến Phát';
const num = (s: string | null) => Number((s ?? '').replace(/[^\d-]/g, ''));

async function supplierRow(page: Page) {
  await page.goto('/suppliers');
  await page.getByRole('textbox', { name: 'Tìm kiếm' }).fill('Viet Tien');
  const row = page.getByRole('row', { name: new RegExp(SUPPLIER) });
  await expect(row).toBeVisible();
  return row;
}
// Supplier cells: code, name, phone, email, debt(4), total(5)
const debtOf = async (page: Page) => num(await (await supplierRow(page)).getByRole('cell').nth(4).textContent());
// Product cells: select, code, image, name, price, cost, onHand(6)
async function onHandOf(page: Page, code: string) {
  await searchProducts(page, code);
  const row = page.getByRole('row', { name: new RegExp(code) }).first();
  await expect(row).toBeVisible();
  return num(await row.getByRole('cell').nth(6).textContent());
}

test('receive goods with partial payment → stock, stock card, supplier debt; then pay the supplier', async ({ page }) => {
  await loginAsAdmin(page);
  const debtBefore = await debtOf(page);
  const stockBefore = await onHandOf(page, 'NA001');

  await page.goto('/purchase-receipts/new');
  await page.getByPlaceholder('Tìm nhà cung cấp').fill('Việt Tiến');
  await page.getByRole('button', { name: new RegExp(SUPPLIER) }).click();
  await addLine(page, 'NA001');
  await page.getByLabel('Số lượng NA001').fill('10');
  await page.getByLabel('Đơn giá NA001').fill('800,000');
  await expect(page.getByTestId('total-due')).toHaveText('8,000,000');
  await page.getByLabel('Tiền trả nhà cung cấp').fill('5,000,000');
  await page.getByRole('button', { name: 'Hoàn thành' }).click();
  await expect(page).toHaveURL(/\/purchase-receipts$/);
  const code = (await page.getByRole('row').nth(2).getByRole('cell').first().textContent())!.trim();
  expect(code).toMatch(/^PN\d{6}$/);

  expect(await onHandOf(page, 'NA001')).toBe(stockBefore + 10);
  await page.getByRole('cell', { name: 'NA001', exact: true }).click();
  await page.getByRole('tab', { name: 'Thẻ kho' }).click();
  await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Nhập hàng');

  expect(await debtOf(page)).toBe(debtBefore + 3_000_000);

  const row = await supplierRow(page);
  await row.getByRole('cell', { name: SUPPLIER }).click();
  await page.getByRole('tab', { name: 'Nợ cần trả NCC' }).click();
  await page.getByRole('button', { name: 'Thanh toán' }).click();
  await page.getByLabel('Số tiền trả').fill('3,000,000');
  await page.getByRole('button', { name: 'Tạo phiếu chi' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await debtOf(page)).toBe(debtBefore);
});
