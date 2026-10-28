import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { mainBranchId, makeCustomer, makeProduct } from './factories';
import { moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let branchId: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  branchId = await mainBranchId(t.prisma);
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
async function product(price: number, vatRate: number | null) {
  const p = await makeProduct(t.prisma, { price, cost: 0 });
  await t.prisma.product.update({ where: { id: p.id }, data: { vatRate } });
  await moveStock(t.prisma, { productId: p.id, branchId, qty: 20, unitCost: 1, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
const sell = async (lines: { productId: number; qty: number; price: number }[], o: object = {}) => {
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  return (await req('POST', '/api/invoices', { lines, payments: [{ method: 'cash', amount: total }], ...o })).json();
};

test('e-invoices: draft from the invoice with VAT by rate; issued numbers are sequential per series; one active per invoice', async () => {
  const c = await makeCustomer(t.prisma, { name: 'Công ty Hoa Mai' });
  const p8 = await product(1_080_000, 8), p10 = await product(110_000, 10);
  const inv = await sell([{ productId: p8.id, qty: 1, price: 1_080_000 }, { productId: p10.id, qty: 1, price: 110_000 }], { customerId: c.id });
  const draft = (await req('POST', '/api/e-invoices', { invoiceId: inv.id, buyerTaxCode: '0101234567' })).json();
  expect([draft.status, draft.total, draft.totalBeforeVat, draft.vatAmount, draft.buyerName, draft.number]).toEqual(['draft', 1_190_000, 1_100_000, 90_000, 'Công ty Hoa Mai', null]);
  expect((await req('POST', '/api/e-invoices', { invoiceId: inv.id })).json().error.code).toBe('EINVOICE_EXISTS');
  const a = (await req('POST', `/api/e-invoices/${draft.id}/issue`, {})).json();
  const inv2 = await sell([{ productId: p10.id, qty: 1, price: 110_000 }]);
  const b = (await req('POST', `/api/e-invoices/${(await req('POST', '/api/e-invoices', { invoiceId: inv2.id })).json().id}/issue`, {})).json();
  expect([a.status, a.series, a.number, b.number]).toEqual(['issued', '1C26TPD', '0000001', '0000002']);
  expect(a.lookupCode).toBeTruthy();
  expect((await req('POST', `/api/e-invoices/${a.id}/issue`, {})).statusCode).toBe(409);
  expect((await req('GET', `/api/e-invoices/${a.id}/print`)).json().rates).toEqual([{ rate: 8, gross: 1_080_000, net: 1_000_000, vat: 80_000 }, { rate: 10, gross: 110_000, net: 100_000, vat: 10_000 }]);

  // An issued e-invoice blocks cancelling its sale until the e-invoice is cancelled; then a new draft is allowed.
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).json().error.code).toBe('EINVOICE_ISSUED');
  expect((await req('POST', `/api/e-invoices/${a.id}/cancel`, { reason: 'Sai thông tin người mua' })).json().status).toBe('cancelled');
  expect((await req('POST', `/api/invoices/${inv.id}/cancel`, {})).statusCode).toBe(200);
  const list = (await req('GET', '/api/e-invoices?status=issued')).json();
  expect(list.items.map((e: { number: string }) => e.number)).toEqual(['0000002']);
});

test('declaration (company mode) groups by VAT rate and nets returns in the quarter', async () => {
  await req('PUT', '/api/settings', { tax: { mode: 'company' } });
  const p = await product(540_000, 8);
  const inv = await sell([{ productId: p.id, qty: 3, price: 540_000 }]);
  const draft = (await req('GET', `/api/invoices/${inv.id}/return-draft`)).json();
  expect((await req('POST', '/api/returns', { invoiceId: inv.id, lines: [{ invoiceLineId: draft.lines[0].invoiceLineId, qty: 1 }], refundMethod: 'cash' })).statusCode).toBe(200);
  const now = new Date(Date.now() + 7 * 3600_000);
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const d = (await req('GET', `/api/tax/declaration?year=${now.getUTCFullYear()}&quarter=${q}`)).json();
  expect(d.mode).toBe('company');
  const r8 = d.rows.find((r: { rate: number }) => r.rate === 8);
  // Earlier test: 1,080,000 at 8% (its invoice cancelled → excluded) — so only this sale: 3 × 540,000 − 540,000 returned.
  expect(r8).toEqual({ rate: 8, gross: 1_080_000, net: 1_000_000, vat: 80_000 });
});

test('household mode applies revenue × (1% VAT + 0.5% PIT)', async () => {
  await req('PUT', '/api/settings', { tax: { mode: 'household' } });
  const now = new Date(Date.now() + 7 * 3600_000);
  const d = (await req('GET', `/api/tax/declaration?year=${now.getUTCFullYear()}&quarter=${Math.floor(now.getUTCMonth() / 3) + 1}`)).json();
  expect(d.mode).toBe('household');
  expect(d.household.vat).toBe(Math.round(d.household.revenue * 0.01));
  expect(d.household.pit).toBe(Math.round(d.household.revenue * 0.005));
  expect(d.household.revenue).toBe(d.rows.reduce((s: number, r: { gross: number }) => s + r.gross, 0));
  await req('PUT', '/api/settings', { tax: { mode: 'company' } });
});

test('auto-issue: a failing e-invoice provider never fails the sale; the draft stays for a manual issue', async () => {
  const { registerEInvoiceProvider, StubEInvoiceProvider } = await import('../src/adapters/einvoice');
  registerEInvoiceProvider({ name: 'down', issue: async () => { throw new Error('provider down'); }, cancel: async () => undefined });
  await req('PUT', '/api/settings', { tax: { autoIssue: true } });
  try {
    const p = await product(200_000, 8);
    const res = await req('POST', '/api/invoices', { lines: [{ productId: p.id, qty: 1, price: 200_000 }], payments: [{ method: 'cash', amount: 200_000 }] });
    expect(res.statusCode).toBe(200);
    const e = await t.prisma.eInvoice.findFirstOrThrow({ where: { invoiceId: res.json().id } });
    expect(e.status).toBe('draft');
    registerEInvoiceProvider(new StubEInvoiceProvider());
    const p2 = await product(200_000, 8);
    const ok = (await req('POST', '/api/invoices', { lines: [{ productId: p2.id, qty: 1, price: 200_000 }], payments: [{ method: 'cash', amount: 200_000 }] })).json();
    expect((await t.prisma.eInvoice.findFirstOrThrow({ where: { invoiceId: ok.id } })).status).toBe('issued');
  } finally {
    registerEInvoiceProvider(new StubEInvoiceProvider());
    await req('PUT', '/api/settings', { tax: { autoIssue: false } });
  }
});
