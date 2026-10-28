import path from 'node:path';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'file:' + path.resolve(import.meta.dirname, '../../../data/app.db'),
  isProd: process.env.NODE_ENV === 'production',
  dataDir: path.resolve(import.meta.dirname, '../../../data'),
};
