import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test('shop order → inbox accept → delivery invoice → delivered → COD reconciled into the cash book; e-invoice issued', async ({ page }) => {
  await loginAsAdmin(page);
  const api = page.request;
  const json = async (r: Awaited<ReturnType<typeof api.get>>) => { expect(r.ok(), await r.text()).toBe(true); return r.json(); };
  await json(await api.put('/api/settings', { data: { pos: { printAfterPayment: false } } }));

  // Storefront: a simple in-stock product, bought through the public checkout.
  const items: { id: number; inStock: boolean }[] = (await json(await api.get('/api/shop/products?pageSize=60'))).items;
  let productId = 0;
  for (const it of items.filter(i => i.inStock)) {
    if (!(await json(await api.get(`/api/shop/products/${it.id}`))).variants.length) { productId = it.id; break; }
  }
  expect(productId).toBeGreaterThan(0);
  await page.goto(`/shop/p/${productId}`);
  await page.getByRole('button', { name: 'Mua ngay' }).click();
  await page.getByLabel('Họ tên').fill('Khách E2E Online');
  await page.getByLabel('Số điện thoại').fill('0987 654 321');
  await page.getByLabel('Tỉnh/Thành phố').selectOption('TP. Hà Nội');
  await page.getByLabel('Địa chỉ').fill('8 Tràng Tiền');
  await page.getByRole('button', { name: 'Đặt hàng' }).click();
  await expect(page.getByText('Đặt hàng thành công')).toBeVisible();
  const orderCode = (await page.locator('b', { hasText: /^DH\d{6}$/ }).textContent())!;

  // Inbox: accept the order.
  await page.goto('/online/orders');
  await page.getByRole('cell', { name: orderCode }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã xác nhận đơn');

  // Convert to a delivery invoice (API), hand it to the carrier.
  const order = (await json(await api.get(`/api/online-orders?status=confirmed&search=${orderCode}`))).items[0];
  const draft = await json(await api.get(`/api/customer-orders/${order.id}/invoice-draft`));
  const partner = (await json(await api.get('/api/delivery-partners?search=Pho Dong'))).items[0];
  const inv = await json(await api.post('/api/invoices', { data: {
    customerId: draft.customerId, orderId: order.id, channel: 'website', payments: [],
    lines: draft.lines.map((l: { productId: number; unitId: number | null; qty: number; price: number }) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, price: l.price })),
    delivery: { receiverName: 'Khách E2E Online', receiverPhone: '0987654321', address: '8 Tràng Tiền', province: 'TP. Hà Nội', partnerId: partner.id, fee: 25_000 },
  } }));
  await json(await api.post(`/api/deliveries/${inv.id}/status`, { data: { to: 'delivering' } }));

  // Waybills: mark delivered.
  await page.goto('/waybills');
  await page.getByRole('textbox', { name: 'Tìm kiếm' }).fill(inv.code);
  const row = page.getByRole('row', { name: new RegExp(inv.code) });
  await row.getByLabel('Chọn dòng').check();
  await page.getByRole('button', { name: 'Cập nhật trạng thái' }).click();
  await page.getByRole('dialog').getByLabel('Trạng thái mới').selectOption('delivered');
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toContainText('Đã cập nhật 1 vận đơn');

  // COD reconciliation → DSCOD voucher in the cash book.
  await page.goto('/deliveries');
  await page.getByRole('button', { name: 'Đối soát COD' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Đối tác').selectOption({ label: partner.name });
  await expect(dlg.getByRole('cell', { name: inv.code })).toBeVisible();
  await expect(dlg.getByTestId('reconcile-amount')).toHaveText(new Intl.NumberFormat('en-US').format(inv.total - 25_000));
  await dlg.getByRole('button', { name: 'Đối soát' }).click();
  await expect(page.getByRole('status')).toContainText(/DSCOD\d{6}/);
  const ds = (await page.getByRole('status').textContent())!.match(/DSCOD\d{6}/)![0];
  await page.goto('/cashbook');
  await expect(page.getByRole('cell', { name: ds })).toBeVisible();

  // E-invoice for the sale.
  await page.goto('/tax/e-invoices');
  await page.getByRole('button', { name: 'Lập HĐĐT' }).click();
  await page.getByRole('dialog').getByLabel('Mã hóa đơn bán').fill(inv.code);
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(page.getByRole('status')).toContainText('Đã lập hóa đơn điện tử nháp');
  await page.getByRole('cell', { name: inv.code }).click();
  await page.getByRole('button', { name: 'Phát hành' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã phát hành' })).toContainText(/Đã phát hành số \d{7}/);
});
