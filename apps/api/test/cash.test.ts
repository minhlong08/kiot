import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { seedBase } from '../src/seed/base';
import { cancelCashBySource, ensureCashDefaults, fundBalance, recordCash } from '../src/services/cash';

const db = createTestDb();
const prisma = db.prisma;
let branchId: number;
const ctx = () => ({ userId: 1, branchId, ip: '' });
beforeAll(async () => { await seedBase(prisma); branchId = (await prisma.branch.findFirstOrThrow()).id; await ensureCashDefaults(prisma); });
afterAll(() => db.close());

test('defaults exist once: cash fund and system categories', async () => {
  await ensureCashDefaults(prisma);
  expect(await prisma.cashFund.count({ where: { type: 'cash' } })).toBe(1);
  expect(await prisma.cashCategory.findFirst({ where: { kind: 'out', name: 'Chi tiền trả NCC', affectsPnl: false } })).toBeTruthy();
});

test('recordCash creates a coded voucher in the default cash fund', async () => {
  const v = await recordCash(prisma, ctx(), { kind: 'out', amount: 500_000, categoryName: 'Chi tiền trả NCC', counterpartyType: 'supplier', counterpartyId: 1, counterpartyName: 'NCC', sourceType: 'receipt', sourceId: 9, sourceCode: 'PN9', codePrefix: 'TTPN' });
  expect(v!.code).toBe('TTPN000001');
  expect(v!.affectsPnl).toBe(false);
  const fund = await prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } });
  expect(await fundBalance(prisma, fund.id)).toBe(-500_000);
});

test('cancelling by source cancels and drops out of the balance', async () => {
  await recordCash(prisma, ctx(), { kind: 'in', amount: 200_000, categoryName: 'Thu khác', counterpartyType: 'other', counterpartyName: 'Khách lẻ', sourceType: 'x', sourceId: 1, sourceCode: 'X1', codePrefix: 'PT' });
  const fund = await prisma.cashFund.findFirstOrThrow({ where: { type: 'cash' } });
  const before = await fundBalance(prisma, fund.id);
  await cancelCashBySource(prisma, ctx(), 'x', 1);
  expect(await fundBalance(prisma, fund.id)).toBe(before - 200_000);
  expect((await prisma.cashVoucher.findFirstOrThrow({ where: { sourceType: 'x' } })).status).toBe('cancelled');
});

test('zero amount creates no voucher', async () => {
  expect(await recordCash(prisma, ctx(), { kind: 'in', amount: 0, categoryName: 'Thu khác', counterpartyType: 'other', counterpartyName: '', codePrefix: 'PT' })).toBeNull();
});
