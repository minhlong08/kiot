import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('VAT by group updates products in the group and its sub-groups only; null clears', async () => {
  const parent = await t.prisma.productGroup.create({ data: { name: 'Phụ kiện' } });
  const child = await t.prisma.productGroup.create({ data: { name: 'Thắt lưng', parentId: parent.id } });
  const other = await t.prisma.productGroup.create({ data: { name: 'Áo' } });
  const [a, b, c] = await Promise.all([makeProduct(t.prisma, { groupId: parent.id }), makeProduct(t.prisma, { groupId: child.id }), makeProduct(t.prisma, { groupId: other.id })]);
  const r = (await req('POST', '/api/products/vat-by-group', { groupId: parent.id, vatRate: 10 })).json();
  expect(r.updated).toBe(2);
  const rates = async () => (await t.prisma.product.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, orderBy: { id: 'asc' } })).map(p => p.vatRate);
  expect(await rates()).toEqual([10, 10, null]);
  await req('POST', '/api/products/vat-by-group', { groupId: parent.id, vatRate: null });
  expect(await rates()).toEqual([null, null, null]);
  expect((await req('POST', '/api/products/vat-by-group', { groupId: parent.id, vatRate: 150 })).statusCode).toBe(400);
});
