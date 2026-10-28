import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL ?? 'file:' + path.resolve(import.meta.dirname, '../../../data/app.db');

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl,
  /** SQLite by default; a postgres:// URL switches the driver adapter and the few dialect-specific statements. */
  dialect: (/^postgres(ql)?:/.test(databaseUrl) ? 'postgres' : 'sqlite') as 'sqlite' | 'postgres',
  /** Built web apps served by the API in production (pnpm build). */
  web: { admin: path.resolve(import.meta.dirname, '../../admin/dist'), pos: path.resolve(import.meta.dirname, '../../pos/dist') },
  isProd: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(import.meta.dirname, '../../../data'),
};
