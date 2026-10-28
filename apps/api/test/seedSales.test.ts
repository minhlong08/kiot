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

test('demo deliveries, online orders and e-invoices keep partner and customer ledgers consistent', async () => {
  const { seedOnline } = await import('../src/seed/online');
  const p = db.prisma;
  await seedOnline(p, new Date('2026-10-28T03:00:00Z'));
  const statuses = (await p.invoiceDelivery.findMany({ orderBy: { invoiceId: 'asc' } })).map(d => d.status);
  expect(statuses.slice(-6)).toEqual(['delivered', 'delivered', 'delivered', 'delivering', 'returned', 'pending']);
  expect(await p.codReconciliation.count()).toBe(1);
  expect(await p.invoiceDelivery.count({ where: { reconciledAt: { not: null } } })).toBe(2);
  for (const d of await p.deliveryPartner.findMany()) expect(await recomputePartnerBalance(p, 'deliveryPartner', d.id)).toBe(d.debt);
  for (const c of await p.customer.findMany()) expect(await recomputePartnerBalance(p, 'customer', c.id)).toBe(c.debt);
  expect(await p.customerOrder.count({ where: { channel: 'website', status: 'pending' } })).toBe(2);
  expect(await p.product.count({ where: { sellOnline: true } })).toBeGreaterThanOrEqual(8);
  expect((await p.eInvoice.findMany({ where: { status: 'issued' } })).map(e => e.number)).toEqual(['0000001', '0000002', '0000003', '0000004', '0000005']);
  expect(await p.branchStock.count({ where: { onHand: { lt: 0 } } })).toBe(0);
});
