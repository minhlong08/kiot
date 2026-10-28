import path from 'node:path';
import { defineConfig } from 'prisma/config';

const defaultUrl = 'file:' + path.resolve(import.meta.dirname, '../../data/app.db');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? defaultUrl },
});
