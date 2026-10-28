import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDb } from './helpers';
import { buildApp } from '../src/app';
import { reserveSql } from '../src/services/codes';

const db = createTestDb();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-web-'));
  const admin = path.join(root, 'admin'), pos = path.join(root, 'pos');
  fs.mkdirSync(path.join(admin, 'assets'), { recursive: true }); fs.mkdirSync(pos);
  fs.writeFileSync(path.join(admin, 'index.html'), '<title>admin</title>');
  fs.writeFileSync(path.join(admin, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(pos, 'index.html'), '<title>pos</title>');
  app = await buildApp({ prisma: db.prisma, web: { admin, pos } });
});
afterAll(async () => { await app.close(); await db.close(); });

test('serves both SPAs with fallbacks; API 404s stay JSON', async () => {
  const get = (url: string) => app.inject({ method: 'GET', url });
  expect((await get('/sale/')).body).toContain('pos');
  expect((await get('/sale/anything/deep')).body).toContain('pos');
  expect((await get('/shop/p/12')).body).toContain('admin');
  expect((await get('/dashboard')).body).toContain('admin');
  expect((await get('/assets/app.js')).body).toBe('console.log(1)');
  const api = await get('/api/does-not-exist');
  // Unauthenticated → 401 from the auth guard; either way an API path never falls back to the HTML app.
  expect([401, 404]).toContain(api.statusCode);
  expect(api.headers['content-type']).toContain('application/json');
});

test('reserveCode SQL uses MAX on SQLite and GREATEST on Postgres', () => {
  expect(reserveSql('sqlite', 'HD', 5).strings.join('?')).toContain('MAX(');
  expect(reserveSql('postgres', 'HD', 5).strings.join('?')).toContain('GREATEST(');
});
