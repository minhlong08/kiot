import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { seedCatalog } from '../src/seed/catalog';
import { seedPurchasing } from '../src/seed/purchasing';
import { recomputePartnerBalance } from '../src/services/partnerLedger';

const db = createTestDb();
afterAll(() => db.close());

test('demo purchasing gives every product stock and consistent supplier debt', async () => {
  const p = db.prisma;
  await seedBase(p);
  await seedCatalog(p);
  await seedPurchasing(p, new Date('2026-10-28T03:00:00Z'));
  expect(await p.supplier.count()).toBe(5);
  const goods = await p.product.findMany({ where: { type: 'goods' } });
  const stocks = await p.branchStock.findMany();
  expect(goods.every(g => (stocks.find(s => s.productId === g.id)?.onHand ?? 0) > 0)).toBe(true);
  expect(await p.purchaseReceipt.count({ where: { status: 'completed' } })).toBeGreaterThanOrEqual(20);
  const first = await p.purchaseReceipt.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  expect(first.createdAt.getTime()).toBeLessThan(new Date('2026-10-01T00:00:00Z').getTime());
  const suppliers = await p.supplier.findMany();
  expect(suppliers.some(s => s.debt > 0)).toBe(true);
  for (const s of suppliers) expect(await recomputePartnerBalance(p, 'supplier', s.id)).toBe(s.debt);
  expect(await p.purchaseReturn.count({ where: { status: 'completed' } })).toBe(1);
  expect(await p.purchaseOrder.count({ where: { status: 'confirmed' } })).toBe(1);
  expect(await p.incomingInvoice.count()).toBe(2);
  expect(await p.servicePurchase.count()).toBe(1);
  expect(await p.cashVoucher.count({ where: { sourceType: 'receipt' } })).toBeGreaterThan(0);
});
