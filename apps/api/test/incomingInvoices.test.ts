import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct, makeSupplier } from './factories';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
beforeAll(async () => { t = await createTestApp(); admin = await t.loginAdmin(); });
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const inv = (o: Record<string, unknown> = {}) => ({ invoiceNo: '0000123', series: '1C26TAA', issuedAt: '2026-10-20T03:00:00Z', supplierName: 'Công ty May Việt', supplierTaxCode: '0312345678', subtotal: 1_000_000, vatAmount: 80_000, total: 1_080_000, ...o });

test('duplicate invoice (series + number + tax code) is refused', async () => {
  expect((await req('POST', '/api/incoming-invoices', inv())).statusCode).toBe(200);
  const dup = await req('POST', '/api/incoming-invoices', inv());
  expect(dup.statusCode).toBe(409);
});

test('linking to a receipt shows on the receipt and the receipt list filter finds it', async () => {
  const s = await makeSupplier(t.prisma);
  const p = await makeProduct(t.prisma);
  const r = (await req('POST', '/api/purchase-receipts', { supplierId: s.id, lines: [{ productId: p.id, qty: 1, unitCost: 1000 }], complete: true })).json();
  const i = (await req('POST', '/api/incoming-invoices', inv({ invoiceNo: '0000999' }))).json();
  await req('POST', `/api/incoming-invoices/${i.id}/link`, { receiptId: r.id });
  expect((await req('GET', `/api/purchase-receipts/${r.id}`)).json().invoices.map((x: { invoiceNo: string }) => x.invoiceNo)).toEqual(['0000999']);
  expect((await req('GET', '/api/purchase-receipts?invoiceNo=0000999')).json().items.map((x: { id: number }) => x.id)).toEqual([r.id]);
  expect((await req('GET', '/api/incoming-invoices?linked=false')).json().items.map((x: { invoiceNo: string }) => x.invoiceNo)).not.toContain('0000999');
});
