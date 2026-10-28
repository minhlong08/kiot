import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { makeProduct } from './factories';
import { adjustCounter, getBranchStock, moveStock, reverseDocument, setOnHand } from '../src/services/stock';
import { seedBase } from '../src/seed/base';

const db = createTestDb();
const prisma = db.prisma;
let branchId: number;
beforeAll(async () => { await seedBase(prisma); branchId = (await prisma.branch.findFirstOrThrow()).id; });
afterAll(() => db.close());

const doc = (docType: string, docId = 1) => ({ docType, docId, docCode: `${docType.toUpperCase()}${docId}` });

test('two receipts give the weighted average and running balances', async () => {
  const p = await makeProduct(prisma, { cost: 0 });
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, ...doc('receipt', 1) });
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 120_000, ...doc('receipt', 2) });
  const s = await getBranchStock(prisma, p.id, branchId);
  expect(s).toMatchObject({ onHand: 20, cost: 110_000 });
  const rows = await prisma.stockLedger.findMany({ where: { productId: p.id }, orderBy: { id: 'asc' } });
  expect(rows.map(r => r.balanceAfter)).toEqual([10, 20]);
  expect(rows[1].costAfter).toBe(110_000);
});

test('issuing beyond stock is refused with the product code', async () => {
  const p = await makeProduct(prisma, { code: 'NA900' });
  await moveStock(prisma, { productId: p.id, branchId, qty: 1, unitCost: 10_000, ...doc('receipt', 3) });
  await expect(moveStock(prisma, { productId: p.id, branchId, qty: -2, ...doc('writeOff', 1) })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', message: expect.stringContaining('NA900') });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(1);
});

test('allowNegative lets stock go below zero and the next receipt sets a sane cost', async () => {
  const p = await makeProduct(prisma, { cost: 90_000 });
  await moveStock(prisma, { productId: p.id, branchId, qty: -2, ...doc('invoice', 1) }, { allowNegative: true });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(-2);
  await moveStock(prisma, { productId: p.id, branchId, qty: 4, unitCost: 100_000, ...doc('receipt', 4) });
  expect(await getBranchStock(prisma, p.id, branchId)).toMatchObject({ onHand: 2, cost: 100_000 });
});

test('the setting allowNegativeStock is honoured when no option is passed', async () => {
  const p = await makeProduct(prisma);
  await prisma.setting.upsert({ where: { key: 'products' }, create: { key: 'products', value: JSON.stringify({ allowNegativeStock: true, costMethod: 'average' }) }, update: { value: JSON.stringify({ allowNegativeStock: true, costMethod: 'average' }) } });
  await moveStock(prisma, { productId: p.id, branchId, qty: -1, ...doc('invoice', 2) });
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(-1);
  await prisma.setting.delete({ where: { key: 'products' } });
});

test('a combo deducts its components and reports the combo unit cost', async () => {
  const a = await makeProduct(prisma, { cost: 0 });
  const b = await makeProduct(prisma, { cost: 0 });
  await moveStock(prisma, { productId: a.id, branchId, qty: 10, unitCost: 30_000, ...doc('receipt', 5) });
  await moveStock(prisma, { productId: b.id, branchId, qty: 10, unitCost: 50_000, ...doc('receipt', 6) });
  const combo = await makeProduct(prisma, { type: 'combo' });
  await prisma.comboItem.createMany({ data: [{ comboId: combo.id, itemId: a.id, qty: 2 }, { comboId: combo.id, itemId: b.id, qty: 1 }] });
  const r = await moveStock(prisma, { productId: combo.id, branchId, qty: -3, ...doc('invoice', 3) });
  expect((await getBranchStock(prisma, a.id, branchId)).onHand).toBe(4);
  expect((await getBranchStock(prisma, b.id, branchId)).onHand).toBe(7);
  expect(r.unitCost).toBe(110_000);
  expect(await prisma.stockLedger.count({ where: { productId: combo.id } })).toBe(0);
});

test('a service never touches stock', async () => {
  const s = await makeProduct(prisma, { type: 'service', cost: 20_000 });
  const r = await moveStock(prisma, { productId: s.id, branchId, qty: -5, ...doc('invoice', 4) });
  expect(r).toEqual({ unitCost: 20_000, lines: [] });
  expect(await prisma.stockLedger.count({ where: { productId: s.id } })).toBe(0);
});

test('first movement uses the product default cost', async () => {
  const p = await makeProduct(prisma, { cost: 77_000 });
  const r = await moveStock(prisma, { productId: p.id, branchId, qty: 3, ...doc('opening', 1) });
  expect(r.unitCost).toBe(77_000);
  expect((await getBranchStock(prisma, p.id, branchId)).cost).toBe(77_000);
});

test('setOnHand writes the difference', async () => {
  const p = await makeProduct(prisma);
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 10_000, ...doc('receipt', 7) });
  const r = await setOnHand(prisma, { productId: p.id, branchId, target: 7, ...doc('stockTake', 1) });
  expect(r.diff).toBe(-3);
  const last = await prisma.stockLedger.findFirstOrThrow({ where: { productId: p.id }, orderBy: { id: 'desc' } });
  expect(last.qtyChange).toBe(-3);
});

test('reverseDocument restores stock with cancel rows', async () => {
  const p = await makeProduct(prisma);
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 10_000, ...doc('receipt', 8) });
  await moveStock(prisma, { productId: p.id, branchId, qty: -4, ...doc('writeOff', 9) });
  await reverseDocument(prisma, 'writeOff', 9, 'writeOff_cancel');
  expect((await getBranchStock(prisma, p.id, branchId)).onHand).toBe(10);
  expect(await prisma.stockLedger.count({ where: { docType: 'writeOff_cancel', docId: 9 } })).toBe(1);
});

test('adjustCounter moves reserved up and down', async () => {
  const p = await makeProduct(prisma);
  await adjustCounter(prisma, p.id, branchId, 'reserved', 2);
  expect((await getBranchStock(prisma, p.id, branchId)).reserved).toBe(2);
  await adjustCounter(prisma, p.id, branchId, 'reserved', -2);
  expect((await getBranchStock(prisma, p.id, branchId)).reserved).toBe(0);
});

test('cancelling a receipt unwinds its effect on the average cost', async () => {
  const p = await makeProduct(prisma, { cost: 0 });
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 100_000, ...doc('receipt', 20) });
  await moveStock(prisma, { productId: p.id, branchId, qty: 10, unitCost: 120_000, ...doc('receipt', 21) });
  await reverseDocument(prisma, 'receipt', 21, 'receipt_cancel');
  expect(await getBranchStock(prisma, p.id, branchId)).toMatchObject({ onHand: 10, cost: 100_000 });
});
