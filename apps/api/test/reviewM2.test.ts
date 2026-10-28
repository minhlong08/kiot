import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp, multipart } from './helpers';
import { makeProduct } from './factories';
import { moveStock } from '../src/services/stock';
import { buildXlsx } from '../src/lib/excel';
import { IMPORT_COLUMNS } from '../src/services/productImport';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let cn1: number;
let cn2: number;
let groupId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  cn1 = (await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } })).id;
  cn2 = (await t.prisma.branch.create({ data: { code: 'CN02', name: 'CN2' } })).id;
  groupId = (await t.prisma.productGroup.create({ data: { name: 'G' } })).id;
});
afterAll(() => t.close());

const req = (method: string, url: string, cookie: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

async function userWith(username: string, perms: string[], branchIds = [cn1]) {
  const role = await t.prisma.role.create({ data: { name: `r-${username}`, permissions: { create: perms.map(key => ({ key })) } } });
  await t.prisma.user.create({ data: { username, fullName: username, passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, defaultBranchId: branchIds[0], branchAccess: { create: branchIds.map(branchId => ({ branchId })) } } });
  return t.login(username, 'pass123');
}

test('I-1: bulk delete needs products.delete', async () => {
  const cookie = await userWith('editor1', ['products.view', 'products.edit']);
  const p = await makeProduct(t.prisma);
  const res = await req('POST', '/api/products/bulk', cookie, { ids: [p.id], action: 'delete' });
  expect(res.statusCode).toBe(403);
  expect(await t.prisma.product.findUnique({ where: { id: p.id } })).not.toBeNull();
});

test('I-2: saving a product without cost.view keeps its cost', async () => {
  const cookie = await userWith('editor2', ['products.view', 'products.edit']);
  const svc = (await req('POST', '/api/products', admin, { name: 'Sửa đồ', type: 'service', price: 50_000, cost: 20_000 })).json();
  const res = await req('PUT', `/api/products/${svc.id}`, cookie, { name: 'Sửa đồ nhanh', type: 'service', price: 60_000 });
  expect(res.statusCode).toBe(200);
  expect((await t.prisma.product.findUniqueOrThrow({ where: { id: svc.id } })).cost).toBe(20_000);
});

test('M-7: create/update responses hide cost without cost.view', async () => {
  const cookie = await userWith('creator', ['products.view', 'products.create']);
  const res = await req('POST', '/api/products', cookie, { name: 'X', type: 'service', price: 1 });
  expect(res.json().cost).toBeUndefined();
});

test('I-3: stock documents of another branch are not reachable', async () => {
  const p = await makeProduct(t.prisma);
  await moveStock(t.prisma, { productId: p.id, branchId: cn1, qty: 5, unitCost: 1000, docType: 'receipt', docId: 1, docCode: 'X' });
  const take = (await req('POST', '/api/stock-takes', admin, { lines: [{ productId: p.id, actualQty: 4 }] })).json();
  const issue = (await req('POST', '/api/stock-issues', admin, { kind: 'writeOff', lines: [{ productId: p.id, qty: 1 }] })).json();
  const other = await userWith('cn2user', ['stockTakes.view', 'stockTakes.edit', 'stockTakes.delete', 'writeOffs.view', 'writeOffs.edit'], [cn2]);
  expect((await req('GET', `/api/stock-takes/${take.id}`, other)).statusCode).toBe(404);
  expect((await req('POST', `/api/stock-takes/${take.id}/balance`, other, {})).statusCode).toBe(404);
  expect((await req('POST', `/api/stock-issues/${issue.id}/complete`, other, {})).statusCode).toBe(404);
});

test('I-3: a transfer can only be sent or cancelled from its source branch', async () => {
  const p = await makeProduct(t.prisma);
  await moveStock(t.prisma, { productId: p.id, branchId: cn1, qty: 5, unitCost: 1000, docType: 'receipt', docId: 2, docCode: 'X' });
  const tr = (await req('POST', '/api/transfers', admin, { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 1 }] })).json();
  const dest = await userWith('dest', ['transfers.view', 'transfers.edit', 'transfers.delete'], [cn2]);
  expect((await req('POST', `/api/transfers/${tr.id}/send`, dest, {})).statusCode).toBe(404);
  expect((await req('POST', `/api/transfers/${tr.id}/cancel`, dest, {})).statusCode).toBe(404);
});

test('I-4: stock documents hide cost and value without cost.view', async () => {
  const p = await makeProduct(t.prisma);
  await moveStock(t.prisma, { productId: p.id, branchId: cn1, qty: 5, unitCost: 7000, docType: 'receipt', docId: 3, docCode: 'X' });
  const w = (await req('POST', '/api/stock-issues', admin, { kind: 'writeOff', lines: [{ productId: p.id, qty: 1 }], complete: true })).json();
  const viewer = await userWith('viewer', ['writeOffs.view']);
  const detail = (await req('GET', `/api/stock-issues/${w.id}`, viewer)).json();
  expect(detail.totalValue).toBeUndefined();
  expect(detail.lines[0].cost).toBeUndefined();
  expect(detail.lines[0].value).toBeUndefined();
  const list = (await req('GET', '/api/stock-issues?kind=writeOff', viewer)).json();
  expect(list.items[0].totalValue).toBeUndefined();
  expect(list.totals.totalValue).toBeUndefined();
});

test('I-5: a variant master or inactive product cannot be a combo component', async () => {
  const master = (await req('POST', '/api/products', admin, { name: 'Áo', type: 'goods', groupId, price: 1, attributes: [{ name: 'Size', values: ['M'] }], variants: [{ values: ['M'], price: 1 }] })).json();
  const res = await req('POST', '/api/products', admin, { name: 'Combo', type: 'combo', groupId, comboItems: [{ itemId: master.id, qty: 1 }] });
  expect(res.statusCode).toBe(400);
  const off = await makeProduct(t.prisma);
  await t.prisma.product.update({ where: { id: off.id }, data: { isActive: false } });
  expect((await req('POST', '/api/products', admin, { name: 'Combo2', type: 'combo', groupId, comboItems: [{ itemId: off.id, qty: 1 }] })).statusCode).toBe(400);
  expect((await req('POST', '/api/stock-takes', admin, { lines: [{ productId: master.id, actualQty: 1 }] })).statusCode).toBe(400);
});

test('I-6: adding variants to a product with stock history is refused', async () => {
  const p = (await req('POST', '/api/products', admin, { name: 'Có tồn', type: 'goods', groupId, price: 1, onHand: 10 })).json();
  const res = await req('PUT', `/api/products/${p.id}`, admin, { name: 'Có tồn', type: 'goods', groupId, price: 1, attributes: [{ name: 'Size', values: ['M'] }], variants: [{ values: ['M'], price: 1 }] });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('HAS_STOCK_HISTORY');
});

test('I-7: import upsert needs products.edit', async () => {
  const cookie = await userWith('importer', ['products.view', 'products.create']);
  const buf = await buildXlsx(IMPORT_COLUMNS, [{ type: 'Hàng hóa', group: 'G', code: 'UPS1', name: 'A', price: 1 }]);
  const mp = multipart('file', 'a.xlsx', buf);
  const res = await t.app.inject({ method: 'POST', url: '/api/products/import?mode=upsert', headers: { cookie, ...mp.headers }, payload: mp.payload });
  expect(res.statusCode).toBe(403);
});

test('M-4: formula on cost needs cost.view', async () => {
  const cookie = await userWith('pricer', ['priceBooks.view', 'priceBooks.edit', 'priceBooks.create']);
  const book = (await req('POST', '/api/price-books', cookie, { name: 'B1' })).json();
  const res = await req('POST', `/api/price-books/${book.id}/apply-formula`, cookie, { base: 'cost', op: '+', value: 0, unit: 'VND' });
  expect(res.statusCode).toBe(403);
});

test('M-5: stock card of a branch outside your access is refused', async () => {
  const cookie = await userWith('cardreader', ['products.view']);
  const p = await makeProduct(t.prisma);
  expect((await req('GET', `/api/products/${p.id}/stock-card?branchId=${cn2}`, cookie)).statusCode).toBe(403);
});
