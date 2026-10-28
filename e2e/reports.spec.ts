import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test('dashboard shows today\'s sale; end of day lists cash; export downloads; P&L picks up a new expense', async ({ page }) => {
  await loginAsAdmin(page);
  const api = page.request;
  const json = async (r: Awaited<ReturnType<typeof api.get>>) => { expect(r.ok(), await r.text()).toBe(true); return r.json(); };
  const product = (await json(await api.get('/api/products?search=DV001'))).items[0];
  const inv = await json(await api.post('/api/invoices', { data: { lines: [{ productId: product.id, qty: 40, price: 50_000 }], payments: [{ method: 'cash', amount: 2_000_000 }] } }));

  // Dashboard: today's KPI and the product at the top by quantity today.
  await page.goto('/dashboard');
  await expect(page.getByText('Kết quả bán hàng hôm nay')).toBeVisible();
  await page.getByLabel('Kỳ xếp hạng').selectOption('today');
  await page.getByLabel('Tiêu chí').selectOption('qty');
  await expect(page.getByText(product.name).first()).toBeVisible();
  await expect(page.getByText(`vừa bán đơn hàng với giá trị ${new Intl.NumberFormat('en-US').format(inv.total)}`).first()).toBeVisible();

  // End of day: cash sales row.
  await page.goto('/reports/end-of-day');
  await expect(page.getByRole('row', { name: /Bán hàng Tiền mặt/ })).toBeVisible();

  // Sales by time: print goes through a sandboxed frame without errors; then export.
  await page.goto('/reports/sales');
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'In', exact: true }).click();
  const frame = page.locator('iframe[sandbox]');
  await expect(frame).toHaveCount(1);
  await expect(frame.contentFrame().locator('h1')).toHaveText('Bán hàng theo thời gian');
  expect(errors).toEqual([]);
  await expect(page.getByRole('columnheader', { name: 'Doanh thu thuần' })).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất file' }).click()]);
  expect(file.suggestedFilename()).toBe('sales-by-time.xlsx');

  // P&L: a "Chi khác" voucher raises this month's expenses by its amount.
  const year = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 4), m = new Date(Date.now() + 7 * 3600_000).toISOString().slice(5, 7);
  const exp = async () => (await json(await api.get(`/api/reports/finance-pnl?year=${year}`))).rows.find((r: { key: string }) => r.key === 'expenses')[`m${m}`];
  const before = await exp();
  const fund = (await json(await api.get('/api/cash-funds'))).find((f: { type: string }) => f.type === 'cash');
  const cat = (await json(await api.get('/api/cash-categories'))).find((c: { name: string }) => c.name === 'Chi khác');
  await json(await api.post('/api/cash-vouchers', { data: { kind: 'out', fundId: fund.id, amount: 123_000, categoryId: cat.id, counterpartyType: 'other', counterpartyName: 'E2E' } }));
  expect(await exp()).toBe(before + 123_000);
  await page.goto('/reports/finance');
  await expect(page.getByRole('row', { name: /Chi phí/ })).toContainText(new Intl.NumberFormat('en-US').format(before + 123_000));
});
