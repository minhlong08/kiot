import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';
import { applicablePriceBooks, priceFor } from '../src/services/priceBooks';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); branchId = (await t.prisma.branch.findFirstOrThrow()).id; });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('formula cost + 30% rounded to thousand writes book prices', async () => {
  const p = await makeProduct(t.prisma, { cost: 820_000, price: 1_500_000 });
  const book = (await req('POST', '/api/price-books', { name: 'Giá sỉ' })).json();
  const res = await req('POST', `/api/price-books/${book.id}/apply-formula`, { productIds: [p.id], base: 'cost', op: '+', value: 30, unit: '%', roundTo: 1000 });
  expect(res.statusCode).toBe(200);
  expect(await priceFor(t.prisma, p.id, book.id)).toBe(1_066_000);
});

test('item override, listing and removal', async () => {
  const p = await makeProduct(t.prisma, { price: 200_000 });
  const book = (await req('POST', '/api/price-books', { name: 'Giá VIP' })).json();
  await req('PUT', `/api/price-books/${book.id}/items`, { items: [{ productId: p.id, price: 180_000 }] });
  const items = (await req('GET', `/api/price-books/${book.id}/items?search=${p.code}`)).json();
  expect(items.items[0]).toMatchObject({ productId: p.id, basePrice: 200_000, price: 180_000 });
  await req('PUT', `/api/price-books/${book.id}/items`, { items: [{ productId: p.id, price: null }] });
  expect(await priceFor(t.prisma, p.id, book.id)).toBe(200_000);
});

test('books outside their validity window are not applicable', async () => {
  const past = (await req('POST', '/api/price-books', { name: 'Hết hạn', startAt: '2020-01-01T00:00:00Z', endAt: '2020-02-01T00:00:00Z' })).json();
  const books = await applicablePriceBooks(t.prisma, { branchId, userId: 1, at: new Date() });
  expect(books.map(b => b.id)).not.toContain(past.id);
});

test('books scoped to another branch are not applicable', async () => {
  const other = await t.prisma.branch.create({ data: { code: 'CN07', name: 'CN7' } });
  const scoped = (await req('POST', '/api/price-books', { name: 'Chỉ CN7', branchIds: [other.id] })).json();
  const here = await applicablePriceBooks(t.prisma, { branchId, userId: 1, at: new Date() });
  const there = await applicablePriceBooks(t.prisma, { branchId: other.id, userId: 1, at: new Date() });
  expect(here.map(b => b.id)).not.toContain(scoped.id);
  expect(there.map(b => b.id)).toContain(scoped.id);
});

test('books scoped to a customer group apply only to that group', async () => {
  const g = (await req('POST', '/api/price-books', { name: 'Nhóm 5', customerGroupIds: [5] })).json();
  expect((await applicablePriceBooks(t.prisma, { branchId, userId: 1, at: new Date() })).map(b => b.id)).not.toContain(g.id);
  expect((await applicablePriceBooks(t.prisma, { branchId, userId: 1, customerGroupId: 5, at: new Date() })).map(b => b.id)).toContain(g.id);
});
