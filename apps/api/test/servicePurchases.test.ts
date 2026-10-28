import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeSupplier } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('a partly paid service purchase writes an expense voucher and supplier debt; cancel reverses both', async () => {
  const s = await makeSupplier(t.prisma);
  const sp = (await req('POST', '/api/service-purchases', { supplierId: s.id, serviceName: 'Thuê vận chuyển', amount: 500_000, paid: 300_000 })).json();
  expect(sp.code).toMatch(/^MDV\d{6}$/);
  const v = await t.prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'servicePurchase', sourceId: sp.id } });
  expect(v).toMatchObject({ kind: 'out', amount: 300_000, affectsPnl: true });
  expect((await t.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(200_000);
  await req('POST', `/api/service-purchases/${sp.id}/cancel`, {});
  expect((await t.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).debt).toBe(0);
  expect((await t.prisma.cashVoucher.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('cancelled');
});

test('without a supplier the full amount must be paid', async () => {
  const res = await req('POST', '/api/service-purchases', { serviceName: 'Sửa điện', amount: 200_000, paid: 100_000 });
  expect(res.statusCode).toBe(400);
  const ok = await req('POST', '/api/service-purchases', { serviceName: 'Sửa điện', amount: 200_000, paid: 200_000 });
  expect(ok.statusCode).toBe(200);
  expect((await req('GET', '/api/service-purchases')).json().totals.amount).toBe(200_000);
});
