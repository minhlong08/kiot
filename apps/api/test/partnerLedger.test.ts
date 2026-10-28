import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { makeSupplier } from './factories';
import { seedBase } from '../src/seed/base';
import { postPartnerLedger, recomputePartnerBalance, reversePartnerDocument } from '../src/services/partnerLedger';

const db = createTestDb();
const prisma = db.prisma;
beforeAll(() => seedBase(prisma));
afterAll(() => db.close());

test('receipt then payment leaves the remaining debt with running balances', async () => {
  const s = await makeSupplier(prisma);
  await postPartnerLedger(prisma, { partnerType: 'supplier', partnerId: s.id, amount: 1_000_000, docType: 'receipt', docId: 1, docCode: 'PN000001' });
  const r = await postPartnerLedger(prisma, { partnerType: 'supplier', partnerId: s.id, amount: -400_000, docType: 'supplierPayment', docId: 1, docCode: 'TTNCC000001' });
  expect(r.balanceAfter).toBe(600_000);
  expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(600_000);
  const rows = await prisma.partnerLedger.findMany({ where: { partnerId: s.id }, orderBy: { id: 'asc' } });
  expect(rows.map(x => x.balanceAfter)).toEqual([1_000_000, 600_000]);
});

test('recompute matches the cached balance', async () => {
  const s = await makeSupplier(prisma);
  await postPartnerLedger(prisma, { partnerType: 'supplier', partnerId: s.id, amount: 250_000, docType: 'receipt', docId: 2, docCode: 'PN2' });
  expect(await recomputePartnerBalance(prisma, 'supplier', s.id)).toBe(250_000);
});

test('reversing a document restores the balance', async () => {
  const s = await makeSupplier(prisma);
  await postPartnerLedger(prisma, { partnerType: 'supplier', partnerId: s.id, amount: 300_000, docType: 'receipt', docId: 3, docCode: 'PN3' });
  await reversePartnerDocument(prisma, 'receipt', 3, 'receipt_cancel');
  expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(0);
  expect(await prisma.partnerLedger.count({ where: { docType: 'receipt_cancel', docId: 3 } })).toBe(1);
});

test('zero amounts write nothing', async () => {
  const s = await makeSupplier(prisma);
  await postPartnerLedger(prisma, { partnerType: 'supplier', partnerId: s.id, amount: 0, docType: 'receipt', docId: 4, docCode: 'PN4' });
  expect(await prisma.partnerLedger.count({ where: { partnerId: s.id } })).toBe(0);
});
