import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let online: { id: number };
let offline: { id: number };
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  branchId = await mainBranchId(t.prisma);
  online = await makeProduct(t.prisma, { name: 'Áo vest online', price: 1_200_000 });
  await t.prisma.product.update({ where: { id: online.id }, data: { sellOnline: true } });
  await moveStock(t.prisma, { productId: online.id, branchId, qty: 5, unitCost: 500_000, docType: 'receipt', docId: 1, docCode: 'PN' });
  offline = await makeProduct(t.prisma, { name: 'Hàng tại quầy', price: 100_000 });
});
afterAll(() => t.close());

const pub = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, payload: payload as object });
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const buyer = { name: 'Trần Thị Hoa', phone: '0912 345 678', address: '5 Lý Thường Kiệt', province: 'Hà Nội', ward: '', note: '' };

test('the shop lists only active products marked for online sale, with stock state', async () => {
  const r = (await pub('GET', '/api/shop/products')).json();
  expect(r.items.map((p: { id: number }) => p.id)).toEqual([online.id]);
  expect(r.items[0]).toMatchObject({ price: 1_200_000, inStock: true });
  expect((await pub('GET', `/api/shop/products/${offline.id}`)).statusCode).toBe(404);
  expect((await pub('GET', '/api/shop/info')).json().name).toBeTruthy();
});

test('a shop order is priced server-side and lands as a pending website order without reserving stock; accept reserves it', async () => {
  const r = await pub('POST', '/api/shop/orders', { customer: buyer, lines: [{ productId: online.id, qty: 2, price: 1 }], website: '' });
  expect(r.statusCode).toBe(200);
  const order = await t.prisma.customerOrder.findUniqueOrThrow({ where: { code: r.json().code }, include: { lines: true } });
  expect([order.channel, order.status, order.total, order.lines[0].price]).toEqual(['website', 'pending', 2_400_000, 1_200_000]);
  const customer = await t.prisma.customer.findUniqueOrThrow({ where: { id: order.customerId! } });
  expect(customer.phone).toBe('0912345678');
  expect((await getBranchStock(t.prisma, online.id, branchId)).reserved).toBe(0);

  const again = (await pub('POST', '/api/shop/orders', { customer: { ...buyer, phone: '0912345678' }, lines: [{ productId: online.id, qty: 1 }], website: '' })).json();
  expect((await t.prisma.customerOrder.findUniqueOrThrow({ where: { code: again.code } })).customerId).toBe(customer.id);

  const inbox = (await req('GET', '/api/online-orders?status=pending')).json();
  expect(inbox.items.map((o: { code: string }) => o.code)).toEqual(expect.arrayContaining([order.code, again.code]));
  expect((await req('POST', `/api/customer-orders/${order.id}/accept`, {})).statusCode).toBe(200);
  expect((await getBranchStock(t.prisma, online.id, branchId)).reserved).toBe(2);
  expect((await req('POST', `/api/customer-orders/${order.id}/accept`, {})).statusCode).toBe(409);
  const other = await t.prisma.customerOrder.findUniqueOrThrow({ where: { code: again.code } });
  expect((await req('POST', `/api/customer-orders/${other.id}/reject`, {})).statusCode).toBe(200);
  expect((await getBranchStock(t.prisma, online.id, branchId)).reserved).toBe(2);
});

test('invalid shop orders are refused: not-online product, zero qty, honeypot filled', async () => {
  expect((await pub('POST', '/api/shop/orders', { customer: buyer, lines: [{ productId: offline.id, qty: 1 }], website: '' })).statusCode).toBe(400);
  expect((await pub('POST', '/api/shop/orders', { customer: buyer, lines: [{ productId: online.id, qty: 0 }], website: '' })).statusCode).toBe(400);
  expect((await pub('POST', '/api/shop/orders', { customer: buyer, lines: [{ productId: online.id, qty: 1 }], website: 'http://spam' })).statusCode).toBe(400);
});

test('sales channels: seeded list, create, and the shop is hidden when online sales are off', async () => {
  const codes = (await req('GET', '/api/sales-channels')).json().map((c: { code: string }) => c.code);
  expect(codes).toEqual(expect.arrayContaining(['store', 'website', 'facebook']));
  expect((await req('POST', '/api/sales-channels', { code: 'tiktok', name: 'TikTok Shop' })).statusCode).toBe(200);
  await req('PUT', '/api/settings', { online: { enabled: false } });
  expect((await pub('GET', '/api/shop/products')).statusCode).toBe(404);
  await req('PUT', '/api/settings', { online: { enabled: true } });
});

test('more than 10 shop orders a minute from one address → 429', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) codes.push((await pub('POST', '/api/shop/orders', { customer: buyer, lines: [{ productId: online.id, qty: 1 }], website: '' })).statusCode);
  expect(codes.at(-1)).toBe(429);
});
