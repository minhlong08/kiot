import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { fakeUser, makeProduct } from './factories';
import { seedBase } from '../src/seed/base';
import { ensureCashDefaults } from '../src/services/cash';
import { getBranchStock, moveStock } from '../src/services/stock';
import { createInvoice } from '../src/services/sales';
import { invoiceInputSchema } from '@pd/shared';

const db = createTestDb();
const prisma = db.prisma;
beforeAll(async () => { await seedBase(prisma); await ensureCashDefaults(prisma); });
afterAll(() => db.close());

test('two tills selling the last unit at once: exactly one succeeds', async () => {
  const branchId = (await prisma.branch.findFirstOrThrow()).id;
  const p = await makeProduct(prisma, { price: 100_000, cost: 0 });
  await moveStock(prisma, { productId: p.id, branchId, qty: 1, unitCost: 50_000, docType: 'receipt', docId: 1, docCode: 'PN' });
  const sale = () => prisma.$transaction(tx => createInvoice(tx, { userId: 1, branchId, ip: '' }, invoiceInputSchema.parse({ lines: [{ productId: p.id, qty: 1, price: 100_000 }], payments: [{ method: 'cash', amount: 100_000 }] }), fakeUser({ isAdmin: true, branchId })));
  const results = await Promise.allSettled([sale(), sale()]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'INSUFFICIENT_STOCK' } });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(0);
});
