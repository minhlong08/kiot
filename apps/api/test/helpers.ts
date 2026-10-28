import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPrisma } from '../src/db';
import { TEMPLATE_DB } from './global-setup';

/** A fresh, migrated SQLite database copied from the template for one test file. */
export function createTestDb() {
  const file = path.join(os.tmpdir(), `pd-test-${randomUUID()}.db`);
  fs.copyFileSync(TEMPLATE_DB, file);
  const prisma = createPrisma('file:' + file);
  return {
    prisma,
    async close() {
      await prisma.$disconnect();
      fs.rmSync(file, { force: true });
    },
  };
}
