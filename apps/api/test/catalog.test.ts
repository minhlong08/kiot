import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('creates nested groups and lists them with product counts', async () => {
  const root = (await req('POST', '/api/product-groups', { name: 'Thời trang Nam' })).json();
  const child = (await req('POST', '/api/product-groups', { name: 'Áo vest', parentId: root.id })).json();
  await makeProduct(t.prisma, { groupId: child.id });
  const list = (await req('GET', '/api/product-groups')).json() as { id: number; parentId: number | null; productCount: number }[];
  expect(list.find(g => g.id === child.id)).toMatchObject({ parentId: root.id, productCount: 1 });
  const log = await t.prisma.auditLog.findFirst({ where: { entity: 'ProductGroup', action: 'create' } });
  expect(log).toBeTruthy();
});

test('a group with children cannot be deleted', async () => {
  const root = (await req('POST', '/api/product-groups', { name: 'Phụ kiện' })).json();
  await req('POST', '/api/product-groups', { name: 'Ví', parentId: root.id });
  const res = await req('DELETE', `/api/product-groups/${root.id}`);
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('GROUP_IN_USE');
});

test('a group cannot become its own descendant', async () => {
  const a = (await req('POST', '/api/product-groups', { name: 'A' })).json();
  const b = (await req('POST', '/api/product-groups', { name: 'B', parentId: a.id })).json();
  const res = await req('PUT', `/api/product-groups/${a.id}`, { name: 'A', parentId: b.id });
  expect(res.statusCode).toBe(400);
});

test('brand names are unique', async () => {
  expect((await req('POST', '/api/brands', { name: 'DKNY' })).statusCode).toBe(200);
  const dup = await req('POST', '/api/brands', { name: 'DKNY' });
  expect(dup.statusCode).toBe(409);
  expect(dup.json().error.code).toBe('DUPLICATE');
});

test('a brand in use cannot be deleted; an unused one can', async () => {
  const used = (await req('POST', '/api/brands', { name: 'HEX' })).json();
  const p = await makeProduct(t.prisma);
  await t.prisma.product.update({ where: { id: p.id }, data: { brandId: used.id } });
  expect((await req('DELETE', `/api/brands/${used.id}`)).json().error.code).toBe('IN_USE');
  const free = (await req('POST', '/api/brands', { name: 'ZAA' })).json();
  expect((await req('DELETE', `/api/brands/${free.id}`)).statusCode).toBe(200);
});

test('locations CRUD', async () => {
  const l = (await req('POST', '/api/locations', { name: 'Kệ A1' })).json();
  expect((await req('PUT', `/api/locations/${l.id}`, { name: 'Kệ A2' })).json().name).toBe('Kệ A2');
  expect(((await req('GET', '/api/locations')).json() as { name: string }[]).map(x => x.name)).toContain('Kệ A2');
});
