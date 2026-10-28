import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const TEMPLATE_DB = path.resolve(import.meta.dirname, '../../../data/test-template.db');

export default function setup() {
  fs.rmSync(TEMPLATE_DB, { force: true });
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: 'file:' + TEMPLATE_DB },
    stdio: 'pipe',
  });
}
