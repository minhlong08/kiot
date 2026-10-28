import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { transition } from '../src/services/transition';

const db = createTestDb();
const prisma = db.prisma;
beforeAll(() => seedBase(prisma));
afterAll(() => db.close());

test('moves a document only from an expected status', async () => {
  const st = await prisma.stockTake.create({ data: { code: 'KKT1', branchId: 1, createdById: 1 } });
  await transition(prisma, 'stockTake', st.id, ['draft'], 'balanced', { balancedAt: new Date() });
  expect((await prisma.stockTake.findUniqueOrThrow({ where: { id: st.id } })).status).toBe('balanced');
  await expect(transition(prisma, 'stockTake', st.id, ['draft'], 'balanced')).rejects.toMatchObject({ code: 'STATE_CHANGED' });
});

test('completing the same receipt twice at once posts it once', async () => {
  const { createTestApp } = await import('./helpers');
  const { makeProduct, makeSupplier } = await import('./factories');
  const t = await createTestApp();
  const cookie = await t.loginAdmin();
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const d = (await t.app.inject({ method: 'POST', url: '/api/purchase-receipts', headers: { cookie }, payload: { supplierId: s.id, lines: [{ productId: p.id, qty: 5, unitCost: 1000 }] } })).json();
  const res = await Promise.all([1, 2].map(() => t.app.inject({ method: 'POST', url: `/api/purchase-receipts/${d.id}/complete`, headers: { cookie }, payload: {} })));
  expect(res.map(r => r.statusCode).sort()).toEqual([200, 409]);
  expect((await t.prisma.branchStock.findFirstOrThrow({ where: { productId: p.id } })).onHand).toBe(5);
  await t.close();
});
