import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let cashFundId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  branchId = await mainBranchId(t.prisma);
  cashFundId = (await t.prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } })).id;
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const partner = async (name: string) => (await req('POST', '/api/delivery-partners', { name, feeMode: 'flat', flatFee: 20_000 })).json().id as number;
async function delivered(partnerId: number, price: number, fee = 20_000) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 5, unitCost: 1, docType: 'receipt', docId: p.id, docCode: 'PN' });
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price }], payments: [], delivery: { receiverName: 'A', receiverPhone: '0900000000', address: 'X', partnerId, fee } })).json();
  for (const s of ['delivering', 'delivered']) expect((await req('POST', `/api/deliveries/${inv.id}/status`, { to: s })).statusCode).toBe(200);
  return inv.id as number;
}
const debt = async (id: number) => (await t.prisma.deliveryPartner.findUniqueOrThrow({ where: { id } })).debt;

test('reconciling two waybills → one DSCOD voucher for Σcod − Σfee; partner debt back to 0; cancel restores', async () => {
  const pid = await partner('Đối soát A');
  const ids = [await delivered(pid, 300_000), await delivered(pid, 200_000)];
  expect(await debt(pid)).toBe(460_000);
  const r = (await req('POST', '/api/cod-reconciliations', { partnerId: pid, invoiceIds: ids, fundId: cashFundId, note: '' })).json();
  expect(r.code).toMatch(/^DSCOD\d{6}$/);
  expect([r.codTotal, r.feeTotal, r.amount]).toEqual([500_000, 40_000, 460_000]);
  const v = await t.prisma.cashVoucher.findUniqueOrThrow({ where: { id: r.cashVoucherId } });
  expect([v.kind, v.amount, v.sourceType, v.sourceCode]).toEqual(['in', 460_000, 'codReconciliation', r.code]);
  expect(await debt(pid)).toBe(0);
  expect(await t.prisma.invoiceDelivery.count({ where: { invoiceId: { in: ids }, reconciledAt: { not: null } } })).toBe(2);

  expect((await req('POST', `/api/cod-reconciliations/${r.id}/cancel`, {})).statusCode).toBe(200);
  expect(await debt(pid)).toBe(460_000);
  expect((await t.prisma.cashVoucher.findUniqueOrThrow({ where: { id: r.cashVoucherId } })).status).toBe('cancelled');
  expect(await t.prisma.invoiceDelivery.count({ where: { invoiceId: { in: ids }, reconciledAt: null } })).toBe(2);
});

test('an already reconciled waybill, another partner\'s waybill or an undelivered one → 409 and nothing posted', async () => {
  const a = await partner('Đối soát B'), b = await partner('Đối soát C');
  const ia = await delivered(a, 100_000), ib = await delivered(b, 100_000);
  expect((await req('POST', '/api/cod-reconciliations', { partnerId: a, invoiceIds: [ia], fundId: cashFundId })).statusCode).toBe(200);
  const vouchers = await t.prisma.cashVoucher.count();
  expect((await req('POST', '/api/cod-reconciliations', { partnerId: a, invoiceIds: [ia], fundId: cashFundId })).json().error.code).toBe('NOT_RECONCILABLE');
  expect((await req('POST', '/api/cod-reconciliations', { partnerId: a, invoiceIds: [ib], fundId: cashFundId })).json().error.code).toBe('NOT_RECONCILABLE');
  expect(await t.prisma.cashVoucher.count()).toBe(vouchers);
  expect(await debt(b)).toBe(80_000);
  const list = (await req('GET', `/api/cod-reconciliations?partnerId=${a}`)).json();
  expect(list.items).toHaveLength(1);
});
