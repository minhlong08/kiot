import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeCustomer, makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let partnerId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  branchId = await mainBranchId(t.prisma);
  partnerId = (await req('POST', '/api/delivery-partners', { name: 'Giao Nhanh Phố', feeMode: 'flat', flatFee: 30_000 })).json().id;
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
async function stocked(price = 300_000) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
const delivery = (o: object = {}) => ({ receiverName: 'Chị Lan', receiverPhone: '0912000111', address: '12 Hàng Bạc', province: 'Hà Nội', partnerId, fee: 30_000, ...o });
async function deliverySale(o: { prepaid?: number; customerId?: number; partner?: number | null } = {}) {
  const p = await stocked();
  const payments = o.prepaid ? [{ method: 'cash', amount: o.prepaid }] : [];
  const inv = (await req('POST', '/api/invoices', { customerId: o.customerId ?? null, lines: [{ productId: p.id, qty: 1, price: 300_000 }], payments, delivery: delivery(o.partner === undefined ? {} : { partnerId: o.partner }) })).json();
  return { inv, p };
}
const status = (id: number, to: string) => req('POST', `/api/deliveries/${id}/status`, { to });
const walk = async (id: number, path: string[]) => { for (const s of path) expect((await status(id, s)).statusCode, s).toBe(200); };
const partnerDebt = async () => (await t.prisma.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } })).debt;

test('delivered with a partner posts COD (minus a shop-paid fee) to the partner once and completes the invoice', async () => {
  const c = await makeCustomer(t.prisma, { name: 'Khách giao hàng' });
  const { inv } = await deliverySale({ prepaid: 100_000, customerId: c.id });
  expect(inv.status).toBe('processing');
  const before = await partnerDebt();
  await walk(inv.id, ['picked', 'delivering', 'delivered']);
  expect(await partnerDebt()).toBe(before + 200_000 - 30_000);
  const after = await t.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
  expect(after.status).toBe('completed');
  expect(after.completedAt).not.toBeNull();
  expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).debt).toBe(0);
  expect(await t.prisma.partnerLedger.count({ where: { partnerType: 'customer', partnerId: c.id, docId: inv.id } })).toBe(2);
});

test('delivered twice → 409 and no second ledger row', async () => {
  const { inv } = await deliverySale();
  await walk(inv.id, ['delivering']);
  const res = await Promise.all([status(inv.id, 'delivered'), status(inv.id, 'delivered')]);
  expect(res.map(r => r.statusCode).sort()).toEqual([200, 409]);
  expect(await t.prisma.partnerLedger.count({ where: { partnerType: 'deliveryPartner', docType: 'deliveryCod', docId: inv.id } })).toBe(1);
});

test('self-delivery: delivered records the COD as TTHD cash and adds it to paid', async () => {
  const { inv } = await deliverySale({ partner: null });
  await walk(inv.id, ['delivering', 'delivered']);
  const vs = await t.prisma.cashVoucher.findMany({ where: { sourceType: 'invoice', sourceId: inv.id, status: 'completed' } });
  expect(vs.map(v => [v.code.slice(0, 4), v.amount])).toEqual([['TTHD', 300_000]]);
  expect((await t.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paid).toBe(300_000);
});

test('returned after a partial prepay refunds the prepaid cash once and restores stock', async () => {
  const { inv, p } = await deliverySale({ prepaid: 100_000 });
  const stockBefore = (await getBranchStock(t.prisma, p.id, branchId)).onHand;
  await walk(inv.id, ['delivering', 'failed', 'returning']);
  expect((await t.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('undeliverable');
  await walk(inv.id, ['returned']);
  expect((await status(inv.id, 'returned')).statusCode).toBe(409);
  expect((await getBranchStock(t.prisma, p.id, branchId)).onHand).toBe(stockBefore + 1);
  expect((await t.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('cancelled');
  expect(await t.prisma.cashVoucher.count({ where: { sourceType: 'invoice', sourceId: inv.id, status: 'completed' } })).toBe(0);
});

test('illegal transitions are refused; a delivery in transit cannot be cancelled from the invoice', async () => {
  const { inv } = await deliverySale();
  expect((await status(inv.id, 'delivered')).json().error.code).toBe('BAD_TRANSITION');
  await walk(inv.id, ['delivering']);
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).json().error.code).toBe('DELIVERY_IN_PROGRESS');
});

test('list filters by status and partner and totals COD and fees; the delivery can be edited while pending', async () => {
  const { inv } = await deliverySale();
  expect((await req('PUT', `/api/deliveries/${inv.id}`, { ...delivery(), address: '99 Hàng Đào', weight: 800 })).json().address).toBe('99 Hàng Đào');
  const list = (await req('GET', `/api/deliveries?status=pending&partnerIds=${partnerId}&search=${inv.code}`)).json();
  expect(list.items.map((d: { invoiceId: number; invoiceCode: string }) => d.invoiceCode)).toEqual([inv.code]);
  expect(list.totals).toEqual({ cod: 300_000, fee: 30_000 });
  await walk(inv.id, ['delivering']);
  expect((await req('PUT', `/api/deliveries/${inv.id}`, delivery())).json().error.code).toBe('DELIVERY_LOCKED');
  const bulk = (await req('POST', '/api/deliveries/bulk-status', { invoiceIds: [inv.id, 999999], to: 'delivered' })).json();
  expect(bulk.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
});

// ── review fixes
test('a delivered carrier waybill with COD cannot be cancelled from the invoice (use a return)', async () => {
  const { inv } = await deliverySale();
  await walk(inv.id, ['delivering', 'delivered']);
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).json().error.code).toBe('DELIVERED_USE_RETURN');
});

test('carrier COD counts as paid once delivered, so a later return can refund it in cash', async () => {
  const { inv } = await deliverySale({ prepaid: 100_000 });
  await walk(inv.id, ['delivering', 'delivered']);
  expect((await t.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paid).toBe(300_000);
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  const ret = await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' });
  expect(ret.statusCode).toBe(200);
  expect(ret.json().refunded).toBe(300_000);
});
