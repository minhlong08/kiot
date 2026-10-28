import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/prisma/client';
import { env } from './env';

export { Prisma };
export type Tx = Prisma.TransactionClient | PrismaClient;
export type Db = PrismaClient;

/** SQLite (default, file in ./data) or Postgres when DATABASE_URL is postgres:// — the client must be generated for that provider. */
export function createPrisma(url: string = env.databaseUrl): PrismaClient {
  if (/^postgres(ql)?:/.test(url)) return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) } as ConstructorParameters<typeof PrismaClient>[0]);
  const adapter = new PrismaBetterSqlite3({ url: url.replace(/^file:/, '') }, { timestampFormat: 'unixepoch-ms' });
  return new PrismaClient({ adapter });
}

let singleton: PrismaClient | undefined;
export function getPrisma(): PrismaClient {
  singleton ??= createPrisma();
  return singleton;
}
