import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestApp } from './helpers';
import { makeProduct } from './factories';
import { getBranchStock, moveStock } from '../src/services/stock';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let cn1: number;
let cn2: number;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAdmin();
  cn1 = (await t.prisma.branch.findFirstOrThrow({ where: { code: 'CN01' } })).id;
  cn2 = (await t.prisma.branch.create({ data: { code: 'CN02', name: 'Chi nhánh 2' } })).id;
});
afterAll(() => t.close());

const req = (method: string, url: string, payload?: unknown) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload: payload as object });
const stock = (productId: number, branchId = cn1) => getBranchStock(t.prisma, productId, branchId);
async function stocked(qty: number, unitCost = 100_000, branchId = cn1) {
  const p = await makeProduct(t.prisma, { cost: 0 });
  await moveStock(t.prisma, { productId: p.id, branchId, qty, unitCost, docType: 'receipt', docId: p.id, docCode: 'PN' });
  return p;
}
const switchTo = (branchId: number) => req('POST', '/api/auth/switch-branch', { branchId });

test('stock take balances against current stock, not the draft snapshot', async () => {
  const p = await stocked(10);
  const draft = (await req('POST', '/api/stock-takes', { note: '', lines: [{ productId: p.id, actualQty: 8 }], balance: false })).json();
  expect(draft.status).toBe('draft');
  expect(draft.code).toMatch(/^KK\d{6}$/);
  await moveStock(t.prisma, { productId: p.id, branchId: cn1, qty: -1, docType: 'invoice', docId: 1, docCode: 'HD1' });
  const bal = (await req('POST', `/api/stock-takes/${draft.id}/balance`, {})).json();
  expect(bal.status).toBe('balanced');
  expect(bal.lines[0]).toMatchObject({ systemQty: 9, actualQty: 8, diffQty: -1, diffValue: -100_000 });
  expect((await stock(p.id)).onHand).toBe(8);
});

test('balancing with zeroMissing zeroes stock of unlisted products', async () => {
  const listed = await stocked(5);
  const unlisted = await stocked(3);
  await req('POST', '/api/stock-takes', { lines: [{ productId: listed.id, actualQty: 5 }], balance: true, zeroMissing: true });
  expect((await stock(unlisted.id)).onHand).toBe(0);
});

test('cancelling a balanced stock take restores stock', async () => {
  const p = await stocked(10);
  const st = (await req('POST', '/api/stock-takes', { lines: [{ productId: p.id, actualQty: 4 }], balance: true })).json();
  expect((await stock(p.id)).onHand).toBe(4);
  const c = (await req('POST', `/api/stock-takes/${st.id}/cancel`, {})).json();
  expect(c.status).toBe('cancelled');
  expect((await stock(p.id)).onHand).toBe(10);
});

test('write-off snapshots value and cancelling restores stock', async () => {
  const p = await stocked(5, 80_000);
  const w = (await req('POST', '/api/stock-issues', { kind: 'writeOff', reason: 'Hàng lỗi', lines: [{ productId: p.id, qty: 2 }], complete: true })).json();
  expect(w).toMatchObject({ status: 'completed', totalQty: 2, totalValue: 160_000 });
  expect(w.code).toMatch(/^XH\d{6}$/);
  expect((await stock(p.id)).onHand).toBe(3);
  await req('POST', `/api/stock-issues/${w.id}/cancel`, {});
  expect((await stock(p.id)).onHand).toBe(5);
});

test('internal use beyond stock is refused and leaves the draft untouched', async () => {
  const p = await stocked(1);
  const res = await req('POST', '/api/stock-issues', { kind: 'internalUse', lines: [{ productId: p.id, qty: 2 }], complete: true });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');
  expect(await t.prisma.stockIssue.count({ where: { kind: 'internalUse' } })).toBe(0);
});

test('draft issue can be edited then completed', async () => {
  const p = await stocked(5);
  const d = (await req('POST', '/api/stock-issues', { kind: 'internalUse', lines: [{ productId: p.id, qty: 1 }], complete: false })).json();
  expect(d.code).toMatch(/^XDNB\d{6}$/);
  await req('PUT', `/api/stock-issues/${d.id}`, { kind: 'internalUse', lines: [{ productId: p.id, qty: 3 }] });
  await req('POST', `/api/stock-issues/${d.id}/complete`, {});
  expect((await stock(p.id)).onHand).toBe(2);
});

test('transfer moves stock between branches and the destination averages cost', async () => {
  const p = await stocked(10, 100_000);
  await moveStock(t.prisma, { productId: p.id, branchId: cn2, qty: 10, unitCost: 120_000, docType: 'receipt', docId: 999, docCode: 'PN' });
  const tr = (await req('POST', '/api/transfers', { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 10 }], send: true })).json();
  expect(tr.status).toBe('inTransit');
  expect((await stock(p.id)).onHand).toBe(0);
  expect((await stock(p.id, cn2)).incoming).toBe(10);
  await switchTo(cn2);
  const rec = (await req('POST', `/api/transfers/${tr.id}/receive`, { lines: [{ productId: p.id, qtyReceived: 10 }] })).json();
  await switchTo(cn1);
  expect(rec.status).toBe('received');
  expect(await stock(p.id, cn2)).toMatchObject({ onHand: 20, cost: 110_000, incoming: 0 });
});

test('a short receipt records the shortfall', async () => {
  const p = await stocked(5);
  const tr = (await req('POST', '/api/transfers', { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 5 }], send: true })).json();
  await switchTo(cn2);
  const rec = (await req('POST', `/api/transfers/${tr.id}/receive`, { lines: [{ productId: p.id, qtyReceived: 4 }] })).json();
  await switchTo(cn1);
  expect(rec).toMatchObject({ totalSentQty: 5, totalReceivedQty: 4 });
  expect((await stock(p.id, cn2)).onHand).toBe(4);
});

test('receiving must happen at the destination branch', async () => {
  const p = await stocked(2);
  const tr = (await req('POST', '/api/transfers', { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 1 }], send: true })).json();
  const res = await req('POST', `/api/transfers/${tr.id}/receive`, { lines: [{ productId: p.id, qtyReceived: 1 }] });
  expect(res.statusCode).toBe(400);
});

test('cancelling an in-transit transfer restores the source', async () => {
  const p = await stocked(6);
  const tr = (await req('POST', '/api/transfers', { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 4 }], send: true })).json();
  await req('POST', `/api/transfers/${tr.id}/cancel`, {});
  expect((await stock(p.id)).onHand).toBe(6);
  expect((await stock(p.id, cn2)).incoming).toBe(0);
});

test('a received transfer cannot be cancelled', async () => {
  const p = await stocked(2);
  const tr = (await req('POST', '/api/transfers', { toBranchId: cn2, lines: [{ productId: p.id, qtySent: 1 }], send: true })).json();
  await switchTo(cn2);
  await req('POST', `/api/transfers/${tr.id}/receive`, { lines: [{ productId: p.id, qtyReceived: 1 }] });
  await switchTo(cn1);
  const res = await req('POST', `/api/transfers/${tr.id}/cancel`, {});
  expect(res.json().error.code).toBe('TRANSFER_RECEIVED');
});

test('document lists filter by status and search code', async () => {
  const list = (await req('GET', '/api/stock-issues?status=completed&kind=writeOff')).json();
  expect(list.items.every((i: { status: string; kind: string }) => i.status === 'completed' && i.kind === 'writeOff')).toBe(true);
  const st = (await req('GET', '/api/stock-takes?search=KK000001')).json();
  expect(st.items.map((i: { code: string }) => i.code)).toEqual(['KK000001']);
});
