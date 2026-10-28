import { expect, test } from '@playwright/test';
import { loginAsAdmin, searchProducts } from './helpers';

const BARCODE = 'E2E-BC-1';

test('receive → sell at POS with discount and points → return → stock card, cash and customer agree', async ({ page }) => {
  await loginAsAdmin(page);
  const api = page.request;
  const json = async (r: Awaited<ReturnType<typeof api.get>>) => { expect(r.ok(), await r.text()).toBe(true); return r.json(); };

  // Setup through the API: no receipt printing, a product with a barcode, goods received, a customer with 100 points.
  await json(await api.put('/api/settings', { data: { pos: { printAfterPayment: false } } }));
  const group = (await json(await api.get('/api/product-groups'))).find((g: { name: string }) => g.name === 'Thời trang Nam');
  const product = await json(await api.post('/api/products', { data: { name: 'Áo sơ mi E2E', type: 'goods', groupId: group.id, barcode: BARCODE, price: 500_000, cost: 0 } }));
  const supplier = (await json(await api.get('/api/suppliers'))).items[0];
  await json(await api.post('/api/purchase-receipts', { data: { supplierId: supplier.id, lines: [{ productId: product.id, qty: 10, unitCost: 200_000 }], paid: 2_000_000, complete: true } }));
  const customer = (await json(await api.get('/api/customers/lookup?q=Mai%20Anh')))[0];
  await json(await api.post(`/api/customers/${customer.id}/adjust-points`, { data: { newPoints: 100, note: 'E2E' } }));
  const debtBefore = customer.debt;

  // POS sale.
  await page.goto('/sale/');
  await page.getByRole('button', { name: 'Để sau' }).click();
  const search = page.getByPlaceholder('Tìm hàng hóa (F3)');
  await search.fill(BARCODE);
  await search.press('Enter');
  await expect(page.getByLabel(`Số lượng ${product.code}`)).toHaveValue('1');
  await page.getByPlaceholder('Tìm khách hàng (F4)').fill('Mai Anh');
  await page.getByRole('button', { name: /Nguyễn Thị Mai Anh/ }).click();
  await page.keyboard.press('F9');
  const panel = page.getByTestId('payment-panel');
  await panel.getByLabel('Giảm giá hóa đơn').fill('50,000');
  await panel.getByLabel('Điểm sử dụng').fill('100');
  await expect(panel.getByTestId('due')).toHaveText('350,000');
  await panel.getByLabel('Số tiền Tiền mặt').fill('400,000');
  await expect(panel.getByTestId('change')).toHaveText('50,000');
  await panel.getByRole('button', { name: 'THANH TOÁN', exact: true }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Đã thanh toán HD');
  const code = (await status.textContent())!.match(/HD\d{6}/)![0];

  // Admin: the invoice exists with a TTHD cash voucher; return the item.
  await page.goto('/invoices');
  await page.getByRole('textbox', { name: 'Tìm kiếm' }).fill(code);
  await page.getByRole('cell', { name: code }).click();
  await expect(page.getByText(/TTHD\d{6}/)).toBeVisible();
  await page.getByRole('table').getByRole('button', { name: 'Trả hàng', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('row').nth(1).getByRole('textbox').fill('1');
  await expect(dialog).toContainText('Cần trả khách: 450,000');
  await dialog.getByRole('button', { name: 'Trả hàng' }).click();
  await expect(dialog).toBeHidden();

  // Stock card: receipt, sale and return.
  await searchProducts(page, 'Ao so mi E2E');
  await page.getByRole('cell', { name: 'Áo sơ mi E2E' }).click();
  await page.getByRole('tab', { name: 'Thẻ kho' }).click();
  for (const label of ['Nhập hàng', 'Bán hàng', 'Khách trả hàng']) await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible();
  const row = page.getByRole('row', { name: /Áo sơ mi E2E/ });
  await expect(row.getByRole('cell').nth(6)).toHaveText('10');

  // Customer: points spent and earned then reversed by the full return; debt unchanged.
  const after = (await json(await api.get(`/api/customers/lookup?q=${customer.code}`)))[0];
  expect(after.points).toBe(0);
  expect(after.debt).toBe(debtBefore);
});
