import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

for (const [name, size] of [['laptop 1366×768', { width: 1366, height: 768 }], ['tablet 820×1180', { width: 820, height: 1180 }]] as const) {
  test(`POS fits ${name} without horizontal scrolling; checkout stays reachable`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginAsAdmin(page);
    await page.goto('/sale/');
    await page.getByRole('button', { name: 'Để sau' }).click();
    await page.getByPlaceholder('Tìm hàng hóa (F3)').fill('DV001');
    await page.getByPlaceholder('Tìm hàng hóa (F3)').press('Enter');
    // The cart line keeps room for the product name.
    const nameWidth = await page.getByTestId('line-DV001').locator('div.min-w-0').first().evaluate(el => el.getBoundingClientRect().width);
    expect(nameWidth).toBeGreaterThan(90);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/pos-cart-${size.width}x${size.height}.png` });
    await page.keyboard.press('F9');
    await expect(page.getByRole('button', { name: 'THANH TOÁN', exact: true })).toBeInViewport();
    await page.screenshot({ path: `test-results/pos-${size.width}x${size.height}.png` });
  });
}
