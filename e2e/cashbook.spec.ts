import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers';

const closing = async (page: Page) => {
  const text = await page.getByTestId('cash-closing').textContent();
  return Number(text!.replace(/[^\d-]/g, ''));
};

test('cash book lists sale and return vouchers; manual phiếu chi, cancel and fund transfer move the balance', async ({ page }) => {
  await loginAsAdmin(page);
  const api = page.request;
  const json = async (r: Awaited<ReturnType<typeof api.get>>) => { expect(r.ok(), await r.text()).toBe(true); return r.json(); };

  // A cash sale and a cash return through the API, an expense category and a bank fund.
  const product = (await json(await api.get('/api/products?search=DV001'))).items[0];
  const inv = await json(await api.post('/api/invoices', { data: { lines: [{ productId: product.id, qty: 2, price: 150_000 }], payments: [{ method: 'cash', amount: 300_000 }] } }));
  const draft = await json(await api.get(`/api/invoices/${inv.id}/return-draft`));
  await json(await api.post('/api/returns', { data: { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' } }));
  await json(await api.post('/api/cash-categories', { data: { kind: 'out', name: 'Chi phí điện nước', affectsPnl: true } }));
  const funds: { type: string; name: string }[] = await json(await api.get('/api/cash-funds'));
  const bank = funds.find(f => f.type === 'bank') ?? await json(await api.post('/api/cash-funds', { data: { type: 'bank', name: 'Ngân hàng E2E', bankName: 'VCB', accountNumber: '0001' } }));

  await page.goto('/cashbook');
  const table = page.getByRole('table');
  await expect(table.getByRole('cell', { name: /^TTHD\d{6}$/ }).first()).toBeVisible();
  await expect(table.getByRole('cell', { name: /^TTTH\d{6}$/ }).first()).toBeVisible();
  const start = await closing(page);

  // Phiếu chi 500,000 lowers the closing balance.
  await page.getByRole('button', { name: 'Lập phiếu chi' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Loại chi').selectOption({ label: 'Chi phí điện nước' });
  await dialog.getByLabel('Số tiền').fill('500,000');
  await dialog.getByLabel('Tên người nhận').fill('Điện lực');
  await dialog.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toContainText(/Đã tạo PC\d{6}/);
  const pc = (await page.getByRole('status').textContent())!.match(/PC\d{6}/)![0];
  await expect.poll(() => closing(page)).toBe(start - 500_000);

  // Cancel it: balance restored.
  await table.getByRole('cell', { name: pc }).click();
  await page.getByRole('button', { name: 'Hủy phiếu' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hủy phiếu' }).click();
  await expect.poll(() => closing(page)).toBe(start);

  // Transfer 1,000,000 cash → bank: both tabs show it.
  await page.getByRole('button', { name: 'Chuyển quỹ' }).click();
  const tf = page.getByRole('dialog');
  await tf.getByLabel('Đến quỹ').selectOption({ label: bank.name });
  await tf.getByLabel('Số tiền chuyển').fill('1,000,000');
  await tf.getByRole('button', { name: 'Lưu' }).click();
  await expect.poll(() => closing(page)).toBe(start - 1_000_000);
  await expect(table.getByRole('cell', { name: 'Chuyển quỹ' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ngân hàng', exact: true }).click();
  await expect(table.getByRole('cell', { name: 'Chuyển quỹ' }).first()).toBeVisible();
});
