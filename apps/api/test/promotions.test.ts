import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';
import { redeemVoucher, releaseVoucher } from '../src/services/promotions';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const tiers = { tiers: [{ minTotal: 2_000_000, value: 5, unit: '%' }, { minTotal: 5_000_000, value: 8, unit: '%', maxDiscount: 1_000_000 }] };

test('evaluate applies the best invoice tier', async () => {
  const p = await makeProduct(t.prisma, { price: 3_000_000 });
  const res = await req('POST', '/api/promotions', { name: 'Giảm theo hóa đơn', type: 'invoiceDiscount', config: tiers });
  expect(res.statusCode).toBe(200);
  expect(res.json().code).toMatch(/^KM\d{6}$/);
  const r = (await req('POST', '/api/promotions/evaluate', { lines: [{ key: 'a', productId: p.id, qty: 1, price: 3_000_000 }] })).json();
  expect(r.invoiceDiscount).toBe(150_000);
});

test('invalid config for the type is refused', async () => {
  expect((await req('POST', '/api/promotions', { name: 'X', type: 'invoiceDiscount', config: { tiers: [] } })).statusCode).toBe(400);
});

test('the active list excludes promotions of other branches and inactive ones', async () => {
  const other = await t.prisma.branch.create({ data: { code: 'CN09', name: 'CN9' } });
  const scoped = (await req('POST', '/api/promotions', { name: 'Chỉ CN9', type: 'invoiceDiscount', config: tiers, branchIds: [other.id] })).json();
  const off = (await req('POST', '/api/promotions', { name: 'Tắt', type: 'invoiceDiscount', config: tiers, isActive: false })).json();
  const ids = ((await req('GET', '/api/promotions/active')).json() as { id: number }[]).map(p => p.id);
  expect(ids).not.toContain(scoped.id);
  expect(ids).not.toContain(off.id);
});

test('gift promotions carry the gift price for comparison', async () => {
  const gift = await makeProduct(t.prisma, { price: 190_000 });
  await req('POST', '/api/promotions', { name: 'Tặng ví', type: 'giftItem', config: { minTotal: 1_000_000, giftProductId: gift.id, giftQty: 1 } });
  const active = (await req('GET', '/api/promotions/active')).json() as { type: string; giftValue?: number }[];
  expect(active.find(p => p.type === 'giftItem')?.giftValue).toBe(190_000);
});

test('generate unique voucher codes and check them', async () => {
  const c = (await req('POST', '/api/voucher-campaigns', { name: 'Giảm 50k', value: 50_000, unit: 'VND', minOrder: 500_000 })).json();
  const g = (await req('POST', `/api/voucher-campaigns/${c.id}/generate`, { count: 50 })).json();
  expect(new Set(g.codes).size).toBe(50);
  expect(g.codes[0]).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  expect((await req('GET', `/api/vouchers/check?code=${g.codes[0]}&total=400000`)).json()).toMatchObject({ valid: false });
  expect((await req('GET', `/api/vouchers/check?code=${g.codes[0]}&total=600000`)).json()).toMatchObject({ valid: true, discount: 50_000 });
});

test('a single-use voucher cannot be redeemed twice; release makes it usable again', async () => {
  const c = (await req('POST', '/api/voucher-campaigns', { name: 'Một lần', value: 10, unit: '%', minOrder: 0 })).json();
  const [code] = (await req('POST', `/api/voucher-campaigns/${c.id}/generate`, { count: 1 })).json().codes;
  const results = await Promise.allSettled([1, 2].map(id => t.prisma.$transaction(tx => redeemVoucher(tx, code, id, 100_000))));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'VOUCHER_USED' } });
  const used = await t.prisma.voucher.findUniqueOrThrow({ where: { code } });
  await t.prisma.$transaction(tx => releaseVoucher(tx, code, used.usedInvoiceId!));
  expect((await t.prisma.voucher.findUniqueOrThrow({ where: { code } })).status).toBe('unused');
});
