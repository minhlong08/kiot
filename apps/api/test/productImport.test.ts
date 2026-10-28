import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp, multipart } from './helpers';
import { buildXlsx } from '../src/lib/excel';
import { IMPORT_COLUMNS } from '../src/services/productImport';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const row = (o: Record<string, unknown>) => ({ type: 'Hàng hóa', group: 'Thời trang Nam>Áo vest', price: 1_000_000, cost: 500_000, onHand: 0, ...o });

async function upload(rows: Record<string, unknown>[], mode = 'create') {
  const buf = await buildXlsx(IMPORT_COLUMNS, rows);
  const mp = multipart('file', 'hang.xlsx', buf);
  return t.app.inject({ method: 'POST', url: `/api/products/import?mode=${mode}`, headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
}

test('the template downloads as xlsx', async () => {
  const res = await t.app.inject({ url: '/api/products/import-template', headers: { cookie: admin } });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('spreadsheetml');
});

test('imports rows and creates the group path, brand and opening stock', async () => {
  const res = await upload([row({ code: 'IMP01', name: 'Áo vest nhập 1', brand: 'Owen', onHand: 3 }), row({ code: 'IMP02', name: 'Áo vest nhập 2' })]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ created: 2, updated: 0, errors: [] });
  const p = await t.prisma.product.findUniqueOrThrow({ where: { code: 'IMP01' } });
  const group = await t.prisma.productGroup.findUniqueOrThrow({ where: { id: p.groupId! } });
  const parent = await t.prisma.productGroup.findUniqueOrThrow({ where: { id: group.parentId! } });
  expect([parent.name, group.name]).toEqual(['Thời trang Nam', 'Áo vest']);
  expect((await t.prisma.brand.findUniqueOrThrow({ where: { id: p.brandId! } })).name).toBe('Owen');
  expect((await t.prisma.branchStock.findFirstOrThrow({ where: { productId: p.id } })).onHand).toBe(3);
});

test('a duplicate code inside the file is reported by row and nothing is written', async () => {
  const before = await t.prisma.product.count();
  const res = await upload([row({ code: 'DUP1', name: 'X' }), row({ code: 'DUP1', name: 'Y' })]);
  expect(res.json().created).toBe(0);
  expect(res.json().errors).toEqual([expect.objectContaining({ row: 3, message: expect.stringContaining('DUP1') })]);
  expect(await t.prisma.product.count()).toBe(before);
});

test('invalid values are reported per row', async () => {
  const res = await upload([row({ code: 'BAD1', name: 'Giá âm', price: -5 }), row({ code: 'BAD2', name: '' })]);
  expect(res.json().errors.map((e: { row: number }) => e.row)).toEqual([2, 3]);
});

test('create mode refuses existing codes; upsert mode updates them', async () => {
  const res = await upload([row({ code: 'IMP01', name: 'Đổi tên' })]);
  expect(res.json().errors[0].message).toContain('IMP01');
  const up = await upload([row({ code: 'IMP01', name: 'Đổi tên', price: 1_200_000 })], 'upsert');
  expect(up.json()).toMatchObject({ created: 0, updated: 1 });
  expect((await t.prisma.product.findUniqueOrThrow({ where: { code: 'IMP01' } })).price).toBe(1_200_000);
});
