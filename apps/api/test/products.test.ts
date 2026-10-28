import { afterAll, beforeAll, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestApp } from './helpers';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let groupId: number;
let branchId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  groupId = (await t.prisma.productGroup.create({ data: { name: 'Thời trang Nam' } })).id;
  branchId = (await t.prisma.branch.findFirstOrThrow()).id;
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown, cookie = admin) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object });

const goods = (o: Record<string, unknown> = {}) => ({ name: 'Áo vest nam xám', type: 'goods', groupId, price: 1_599_000, cost: 690_000, ...o });

test('creating goods with initial stock writes an opening ledger row', async () => {
  const res = await req('POST', '/api/products', goods({ onHand: 5 }));
  expect(res.statusCode).toBe(200);
  const p = res.json();
  const ledger = await t.prisma.stockLedger.findFirstOrThrow({ where: { productId: p.id } });
  expect(ledger).toMatchObject({ docType: 'opening', qtyChange: 5, unitCost: 690_000, balanceAfter: 5 });
  const audit = await t.prisma.auditLog.findFirst({ where: { entity: 'Product', entityId: String(p.id), action: 'create' } });
  expect(audit).toBeTruthy();
});

test('codes are automatic, respect typed codes, and continue after them', async () => {
  const a = (await req('POST', '/api/products', goods({ name: 'A' }))).json();
  expect(a.code).toMatch(/^SP\d{6}$/);
  const typed = (await req('POST', '/api/products', goods({ name: 'B', code: 'SP000050' }))).json();
  expect(typed.code).toBe('SP000050');
  expect((await req('POST', '/api/products', goods({ name: 'C' }))).json().code).toBe('SP000051');
});

test('duplicate codes are refused', async () => {
  await req('POST', '/api/products', goods({ code: 'NA001' }));
  const dup = await req('POST', '/api/products', goods({ code: 'NA001' }));
  expect(dup.statusCode).toBe(409);
});

test('variants become children and the list shows children, not the master', async () => {
  const res = await req('POST', '/api/products', goods({
    name: 'Quần âu', code: 'QA', attributes: [{ name: 'Màu', values: ['Đen', 'Xám'] }, { name: 'Size', values: ['M', 'L'] }],
    variants: [
      { values: ['Đen', 'M'], price: 500_000, onHand: 2 }, { values: ['Đen', 'L'], price: 500_000 },
      { values: ['Xám', 'M'], price: 520_000 }, { values: ['Xám', 'L'], price: 520_000 },
    ],
  }));
  expect(res.statusCode).toBe(200);
  const master = res.json();
  const children = await t.prisma.product.findMany({ where: { parentId: master.id }, orderBy: { id: 'asc' } });
  expect(children.map(c => c.name)).toEqual(['Quần âu - Đen - M', 'Quần âu - Đen - L', 'Quần âu - Xám - M', 'Quần âu - Xám - L']);
  expect(children[0].code).toBe('QA-1');
  const list = (await req('GET', '/api/products?search=quan%20au')).json();
  expect(list.total).toBe(4);
  expect(list.items.find((i: { id: number }) => i.id === master.id)).toBeUndefined();
  expect(list.items.find((i: { code: string }) => i.code === 'QA-1').onHand).toBe(2);
});

test('removing a variant on update deactivates that child', async () => {
  const master = (await req('POST', '/api/products', goods({ name: 'Sơ mi', attributes: [{ name: 'Size', values: ['M', 'L'] }], variants: [{ values: ['M'], price: 1 }, { values: ['L'], price: 1 }] }))).json();
  const detail = (await req('GET', `/api/products/${master.id}`)).json();
  const keep = detail.variants.find((v: { values: string[] }) => v.values[0] === 'M');
  const upd = await req('PUT', `/api/products/${master.id}`, goods({ name: 'Sơ mi', attributes: [{ name: 'Size', values: ['M'] }], variants: [{ id: keep.id, values: ['M'], price: 2 }] }));
  expect(upd.statusCode).toBe(200);
  const children = await t.prisma.product.findMany({ where: { parentId: master.id } });
  expect(children.find(c => c.variantLabel === 'L')!.isActive).toBe(false);
  expect(children.find(c => c.variantLabel === 'M')!.price).toBe(2);
});

test('a combo requires components', async () => {
  const res = await req('POST', '/api/products', { name: 'Set', type: 'combo', groupId, comboItems: [] });
  expect(res.statusCode).toBe(400);
});

test('combo saves its components', async () => {
  const a = (await req('POST', '/api/products', goods({ name: 'Cà vạt' }))).json();
  const c = (await req('POST', '/api/products', { name: 'Set quà', type: 'combo', groupId, price: 900_000, comboItems: [{ itemId: a.id, qty: 2 }] })).json();
  const detail = (await req('GET', `/api/products/${c.id}`)).json();
  expect(detail.comboItems).toEqual([expect.objectContaining({ itemId: a.id, qty: 2, code: a.code })]);
});

test('search ignores diacritics', async () => {
  await req('POST', '/api/products', goods({ name: 'Áo vest nam đen', code: 'VEST01' }));
  const list = (await req('GET', '/api/products?search=ao%20vest%20nam%20den')).json();
  expect(list.items.map((i: { code: string }) => i.code)).toContain('VEST01');
});

test('stock filter belowMin and totals over the whole filter', async () => {
  const p = (await req('POST', '/api/products', goods({ name: 'Thắt lưng', code: 'TL01', minStock: 3, onHand: 1 }))).json();
  const list = (await req('GET', '/api/products?stock=belowMin')).json();
  expect(list.items.map((i: { id: number }) => i.id)).toContain(p.id);
  expect(list.totals.onHand).toBe(list.items.reduce((s: number, i: { onHand: number }) => s + i.onHand, 0));
});

test('group filter includes subgroups', async () => {
  const child = await t.prisma.productGroup.create({ data: { name: 'Áo', parentId: groupId } });
  const p = (await req('POST', '/api/products', goods({ name: 'Áo phông', groupId: child.id }))).json();
  const list = (await req('GET', `/api/products?groupIds=${groupId}&pageSize=100`)).json();
  expect(list.items.map((i: { id: number }) => i.id)).toContain(p.id);
});

test('cost is hidden from users without cost.view', async () => {
  const role = await t.prisma.role.create({ data: { name: 'Xem hàng', permissions: { create: [{ key: 'products.view' }] } } });
  await t.prisma.user.create({ data: { username: 'viewer', fullName: 'V', passwordHash: bcrypt.hashSync('pass123', 4), roleId: role.id, branchAccess: { create: [{ branchId }] } } });
  const cookie = await t.login('viewer', 'pass123');
  const list = (await req('GET', '/api/products', undefined, cookie)).json();
  expect(list.items.length).toBeGreaterThan(0);
  expect(list.items.every((i: { cost?: number }) => i.cost === undefined)).toBe(true);
  const one = (await req('GET', `/api/products/${list.items[0].id}`, undefined, cookie)).json();
  expect(one.cost).toBeUndefined();
});

test('deleting a product with history deactivates it; without history removes it', async () => {
  const used = (await req('POST', '/api/products', goods({ name: 'Có lịch sử', onHand: 1 }))).json();
  expect((await req('DELETE', `/api/products/${used.id}`)).json()).toEqual({ deactivated: true });
  expect((await t.prisma.product.findUniqueOrThrow({ where: { id: used.id } })).isActive).toBe(false);
  const fresh = (await req('POST', '/api/products', goods({ name: 'Mới tinh' }))).json();
  expect((await req('DELETE', `/api/products/${fresh.id}`)).json()).toEqual({ deleted: true });
  expect(await t.prisma.product.findUnique({ where: { id: fresh.id } })).toBeNull();
});

test('lookup returns the exact barcode match first, and unit rows', async () => {
  const p = (await req('POST', '/api/products', goods({ name: 'Tất nam', code: 'TAT01', barcode: '8930001', unit: 'đôi', units: [{ name: 'hộp', conversion: 6, price: 300_000, barcode: '8930006' }] }))).json();
  const byBarcode = (await req('GET', '/api/products/lookup?q=8930001')).json();
  expect(byBarcode[0]).toMatchObject({ productId: p.id, unitId: null, conversion: 1 });
  const unit = (await req('GET', '/api/products/lookup?q=8930006')).json();
  expect(unit[0]).toMatchObject({ productId: p.id, unitName: 'hộp', conversion: 6, price: 300_000 });
});

test('stock card lists movements newest first and per-branch stock is reported', async () => {
  const p = (await req('POST', '/api/products', goods({ name: 'Ví da', onHand: 4 }))).json();
  await t.prisma.$transaction(tx => moveStock(tx, { productId: p.id, branchId, qty: -1, docType: 'writeOff', docId: 1, docCode: 'XH000001' }));
  const card = (await req('GET', `/api/products/${p.id}/stock-card`)).json();
  expect(card.items.map((r: { qtyChange: number }) => r.qtyChange)).toEqual([-1, 4]);
  const detail = (await req('GET', `/api/products/${p.id}`)).json();
  expect(detail.stocks[0]).toMatchObject({ branchId, onHand: 3 });
});

test('copy returns a draft without a code', async () => {
  const p = (await req('POST', '/api/products', goods({ name: 'Bản gốc', code: 'ORIG1' }))).json();
  const draft = (await req('POST', `/api/products/${p.id}/copy`)).json();
  expect(draft.code).toBeUndefined();
  expect(draft.name).toBe('Bản gốc');
});

test('bulk deactivate and set group', async () => {
  const a = (await req('POST', '/api/products', goods({ name: 'Bulk A' }))).json();
  const g2 = await t.prisma.productGroup.create({ data: { name: 'Khác' } });
  await req('POST', '/api/products/bulk', { ids: [a.id], action: 'setGroup', groupId: g2.id });
  await req('POST', '/api/products/bulk', { ids: [a.id], action: 'deactivate' });
  const row = await t.prisma.product.findUniqueOrThrow({ where: { id: a.id } });
  expect(row).toMatchObject({ groupId: g2.id, isActive: false });
});

test('export is an xlsx file', async () => {
  const res = await req('GET', '/api/products/export');
  expect(res.headers['content-type']).toContain('spreadsheetml');
});
