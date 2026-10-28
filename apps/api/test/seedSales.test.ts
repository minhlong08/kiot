import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';
import { seedPurchasing } from '../src/seed/purchasing';
import { seedCustomers } from '../src/seed/customers';
import { seedSales } from '../src/seed/sales';
import { recomputePartnerBalance } from '../src/services/partnerLedger';
import { recomputePoints } from '../src/services/loyalty';

const db = createTestDb();
afterAll(() => db.close());

test('demo sales over 30 days keep stock, debt and points consistent', async () => {
  const p = db.prisma;
  const now = new Date('2026-10-28T03:00:00Z');
  await seedBase(p); await seedCatalog(p); await seedPurchasing(p, now); await seedCustomers(p);
  await seedSales(p, now);
  const invoices = await p.invoice.count({ where: { status: { not: 'cancelled' } } });
  expect(invoices).toBeGreaterThanOrEqual(40);
  expect(await p.saleReturn.count()).toBe(3);
  expect(await p.saleReturn.count({ where: { exchangeInvoiceId: { not: null } } })).toBe(1);
  expect(await p.customerOrder.count()).toBe(2);
  expect(await p.branchStock.count({ where: { onHand: { lt: 0 } } })).toBe(0);
  const oldest = await p.invoice.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  expect(now.getTime() - oldest.createdAt.getTime()).toBeGreaterThan(20 * 86400_000);
  for (const c of await p.customer.findMany()) {
    expect(await recomputePartnerBalance(p, 'customer', c.id)).toBe(c.debt);
    expect(await recomputePoints(p, c.id)).toBe(c.points);
  }
  expect(await p.shift.count({ where: { closedAt: { not: null } } })).toBeGreaterThan(10);
});
