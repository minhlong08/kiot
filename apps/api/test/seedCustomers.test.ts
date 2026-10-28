import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';
import { seedCustomers } from '../src/seed/customers';

const db = createTestDb();
afterAll(() => db.close());

test('demo customers, groups, promotions and vouchers', async () => {
  const p = db.prisma;
  await seedBase(p);
  await seedCatalog(p);
  await seedCustomers(p);
  expect(await p.customer.count()).toBe(6);
  expect(await p.customerGroup.count()).toBe(2);
  expect(await p.promotion.count()).toBe(3);
  expect(await p.voucher.count()).toBe(20);
  expect(await p.messageTemplate.count()).toBe(2);
  const tie = await p.promotion.findFirstOrThrow({ where: { type: 'buyXGetY' } });
  expect(JSON.parse(tie.config).buyProductIds.length).toBeGreaterThan(0);
});
