import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { makeCustomer } from './factories';
import { seedBase } from '../src/seed/base';
import { postLoyalty, recomputePoints, reverseLoyaltyDocument } from '../src/services/loyalty';
import { postPartnerLedger, recomputePartnerBalance } from '../src/services/partnerLedger';

const db = createTestDb();
const prisma = db.prisma;
beforeAll(() => seedBase(prisma));
afterAll(() => db.close());

test('customer debt goes through the partner ledger', async () => {
  const c = await makeCustomer(prisma);
  await postPartnerLedger(prisma, { partnerType: 'customer', partnerId: c.id, amount: 300_000, docType: 'invoice', docId: 1, docCode: 'HD1' });
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(300_000);
  expect(await recomputePartnerBalance(prisma, 'customer', c.id)).toBe(300_000);
});

test('points earn and redeem with running balance', async () => {
  const c = await makeCustomer(prisma);
  await postLoyalty(prisma, { customerId: c.id, points: 120, docType: 'invoice', docId: 1, docCode: 'HD1' });
  const r = await postLoyalty(prisma, { customerId: c.id, points: -20, docType: 'invoiceRedeem', docId: 2, docCode: 'HD2' });
  expect(r.balanceAfter).toBe(100);
  expect(await recomputePoints(prisma, c.id)).toBe(100);
});

test('redeeming more points than held is refused', async () => {
  const c = await makeCustomer(prisma);
  await postLoyalty(prisma, { customerId: c.id, points: 10, docType: 'invoice', docId: 3, docCode: 'HD3' });
  await expect(postLoyalty(prisma, { customerId: c.id, points: -11, docType: 'invoiceRedeem', docId: 4, docCode: 'HD4' })).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
});

test('reversing a document restores points', async () => {
  const c = await makeCustomer(prisma);
  await postLoyalty(prisma, { customerId: c.id, points: 50, docType: 'invoice', docId: 5, docCode: 'HD5' });
  await reverseLoyaltyDocument(prisma, 'invoice', 5, 'invoice_cancel');
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).points).toBe(0);
});
