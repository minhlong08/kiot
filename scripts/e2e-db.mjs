// Starts every E2E run from an empty database so the seed (and forced password change) runs fresh.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '../data/e2e.db');
for (const f of [file, file + '-journal', file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
