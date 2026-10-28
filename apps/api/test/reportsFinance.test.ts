import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';
import { postPartnerLedger } from '../src/services/partnerLedger';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
let cashFundId: number;
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
beforeAll(async () => {
  t = await createTestApp(); admin = await t.loginAdmin(); branchId = await mainBranchId(t.prisma);
  cashFundId = (await t.prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } })).id;
});
afterAll(() => t.close());
const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });

test('end of day: cash in/out from the cash book, sales by payment method, returns', async () => {
  const p = await makeProduct(t.prisma, { price: 300_000, cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, docType: 'receipt', docId: p.id, docCode: 'PN' });
  await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 300_000 }], payments: [{ method: 'cash', amount: 500_000 }] });
  const inv = (await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 2, price: 300_000 }], payments: [{ method: 'transfer', amount: 600_000 }] })).json();
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' });
  const r = (await req('GET', `/api/reports/end-of-day?date=${vnToday()}`)).json();
  const get = (section: string, label: string) => r.rows.find((x: { section: string; label: string }) => x.section === section && x.label === label)?.amount;
  expect(get('Bán hàng', 'Tiền mặt')).toBe(300_000);
  expect(get('Bán hàng', 'Chuyển khoản')).toBe(600_000);
  expect(get('Trả hàng', 'Tiền mặt')).toBe(300_000);
  const vouchers = await t.prisma.cashVoucher.findMany({ where: { status: 'completed', fundId: cashFundId } });
  const cashIn = vouchers.filter(v => v.kind === 'in').reduce((s, v) => s + v.amount, 0), cashOut = vouchers.filter(v => v.kind === 'out').reduce((s, v) => s + v.amount, 0);
  expect([get('Tiền mặt', 'Thu'), get('Tiền mặt', 'Chi'), get('Tiền mặt', 'Chênh lệch')]).toEqual([cashIn, cashOut, cashIn - cashOut]);
});

test('P&L by month: net revenue − COGS − expenses (P&L categories, shop-paid delivery fees) + other income; cancelled vouchers excluded', async () => {
  const year = Number(vnToday().slice(0, 4)), m = vnToday().slice(5, 7);
  const elec = (await req('POST', '/api/cash-categories', { kind: 'out', name: 'Chi phí điện nước', affectsPnl: true })).json();
  const salary = await t.prisma.cashCategory.findFirstOrThrow({ where: { name: 'Chi lương' } });
  const otherIn = await t.prisma.cashCategory.findFirstOrThrow({ where: { name: 'Thu khác' } });
  const supplierPay = await t.prisma.cashCategory.findFirstOrThrow({ where: { name: 'Chi tiền trả NCC' } });
  const voucher = (kind: string, categoryId: number, amount: number) => req('POST', '/api/cash-vouchers', { kind, fundId: cashFundId, amount, categoryId, counterpartyType: 'other', counterpartyName: 'X' }).then(r => r.json());
  await voucher('out', elec.id, 1_000_000);
  await voucher('out', salary.id, 2_000_000);
  await voucher('out', supplierPay.id, 5_000_000); // not an expense (pays a debt)
  await voucher('in', otherIn.id, 150_000);
  const cancelled = await voucher('out', elec.id, 999_000);
  await req('POST', `/api/cash-vouchers/${cancelled.id}/cancel`, {});
  const partner = (await req('POST', '/api/delivery-partners', { name: 'Giao thử', feeMode: 'flat', flatFee: 25_000 })).json();
  await postPartnerLedger(t.prisma, { partnerType: 'deliveryPartner', partnerId: partner.id, amount: -25_000, docType: 'deliveryFee', docId: 1, docCode: 'HD' });

  const r = (await req('GET', `/api/reports/finance-pnl?year=${year}`)).json();
  const row = (key: string) => r.rows.find((x: { key: string }) => x.key === key)[`m${m}`];
  // Sales from the previous test: 900,000 revenue, 300,000 returned; COGS 300,000 − 100,000.
  expect([row('revenue'), row('returns'), row('net'), row('cogs')]).toEqual([900_000, 300_000, 600_000, 200_000]);
  expect(row('expenses')).toBe(1_000_000 + 2_000_000 + 25_000);
  expect(row('otherIncome')).toBe(150_000);
  expect(row('profit')).toBe(600_000 - 200_000 - 3_025_000 + 150_000);
  expect(r.rows.find((x: { key: string }) => x.key === 'profit').total).toBe(row('profit'));
});
