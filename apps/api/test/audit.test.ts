import { afterAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { audit } from '../src/services/audit';

const db = createTestDb();
const prisma = db.prisma;
afterAll(() => db.close());

test('audit stores changed keys only', async () => {
  await audit(prisma, { userId: null, branchId: null, ip: '' }, {
    action: 'update', entity: 'Branch', entityId: 1, summary: 's',
    before: { name: 'A', phone: '1' }, after: { name: 'B', phone: '1' },
  });
  const row = await prisma.auditLog.findFirstOrThrow();
  expect(JSON.parse(row.diff)).toEqual({ name: ['A', 'B'] });
  expect(row.entityId).toBe('1');
});

test('audit on create stores the new values', async () => {
  await audit(prisma, { userId: 7, branchId: 1, ip: '127.0.0.1' }, {
    action: 'create', entity: 'Role', entityId: 3, entityCode: 'R3', summary: 'Tạo vai trò', after: { name: 'Thu ngân' },
  });
  const row = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Role' } });
  expect(JSON.parse(row.diff)).toEqual({ name: [null, 'Thu ngân'] });
  expect(row.userId).toBe(7);
});
