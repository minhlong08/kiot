import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { nextCode, reserveCode } from '../src/services/codes';

const db = createTestDb();
const prisma = db.prisma;
afterAll(() => db.close());

test('nextCode is sequential and padded', async () => {
  expect(await nextCode(prisma, 'HD')).toBe('HD000001');
  expect(await nextCode(prisma, 'HD')).toBe('HD000002');
});

test('nextCode is unique under concurrency', async () => {
  const codes = await Promise.all(Array.from({ length: 20 }, () => prisma.$transaction(tx => nextCode(tx, 'PN'))));
  expect(new Set(codes).size).toBe(20);
});

test('reserveCode skips past manual codes', async () => {
  await reserveCode(prisma, 'KK', 'KK000050');
  expect(await nextCode(prisma, 'KK')).toBe('KK000051');
});

test('reserveCode never moves the sequence backwards', async () => {
  await reserveCode(prisma, 'HD', 'HD000001');
  expect(await nextCode(prisma, 'HD')).toBe('HD000003');
});
