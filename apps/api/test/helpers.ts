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

/** App wired to a fresh seeded database. `login` returns the session cookie header value. */
export async function createTestApp() {
  const db = createTestDb();
  const { seedBase } = await import('../src/seed/base');
  await seedBase(db.prisma);
  const { buildApp } = await import('../src/app');
  const app = await buildApp({ prisma: db.prisma });

  async function login(loginName = 'admin', password = 'admin123'): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: loginName, password } });
    if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
    const c = res.cookies.find(c => c.name === 'pd_sid');
    return `pd_sid=${c!.value}`;
  }

  /** Logs in as admin and completes the forced password change. */
  async function loginAdmin(): Promise<string> {
    const cookie = await login('admin', 'admin123');
    await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { cookie }, payload: { currentPassword: 'admin123', newPassword: 'Admin@2026' } });
    await db.prisma.user.update({ where: { username: 'admin' }, data: { passwordHash: (await import('bcryptjs')).hashSync('admin123', 4) } });
    return cookie;
  }

  return {
    app,
    prisma: db.prisma,
    login,
    loginAdmin,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Builds a multipart/form-data payload with one file field for app.inject. */
export function multipart(field: string, filename: string, content: Buffer, contentType = 'application/octet-stream') {
  const boundary = '----pdtest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, content, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
