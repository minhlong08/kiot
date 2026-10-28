import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient, Prisma } from './generated/prisma/client';
import { env } from './env';

export { Prisma };
export type Tx = Prisma.TransactionClient | PrismaClient;
export type Db = PrismaClient;

export function createPrisma(url: string = env.databaseUrl): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: url.replace(/^file:/, '') }, { timestampFormat: 'unixepoch-ms' });
  return new PrismaClient({ adapter });
}

let singleton: PrismaClient | undefined;
export function getPrisma(): PrismaClient {
  singleton ??= createPrisma();
  return singleton;
}
