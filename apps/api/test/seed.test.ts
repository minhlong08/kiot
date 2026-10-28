import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';

const db = createTestDb();
afterAll(() => db.close());

test('demo catalogue seeds 40 fashion products plus a service and a combo, once', async () => {
  await seedBase(db.prisma);
  await seedCatalog(db.prisma);
  await seedCatalog(db.prisma);
  expect(await db.prisma.product.count({ where: { type: 'goods' } })).toBe(40);
  expect(await db.prisma.product.count({ where: { code: { startsWith: 'NU' } } })).toBe(16);
  expect(await db.prisma.comboItem.count()).toBe(2);
  expect(await db.prisma.productImage.count()).toBe(40);
});
