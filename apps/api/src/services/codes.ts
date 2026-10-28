import { formatCode } from '@pd/shared';
import { Prisma, type Tx } from '../db';
import { env } from '../env';

/** Atomically takes the next number for `prefix` (single upsert statement, safe under concurrency). */
export async function nextCode(tx: Tx, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<{ n: number | bigint }[]>`
    INSERT INTO "DocumentSequence" ("prefix", "next") VALUES (${prefix}, 2)
    ON CONFLICT ("prefix") DO UPDATE SET "next" = "DocumentSequence"."next" + 1
    RETURNING "next" - 1 AS n`;
  return formatCode(prefix, Number(rows[0].n));
}

/** When a user types a code like PREFIX000050, move the sequence past it so auto codes never collide. */
export async function reserveCode(tx: Tx, prefix: string, code: string): Promise<void> {
  const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{6,})$`).exec(code);
  if (!m) return;
  await tx.$executeRaw(reserveSql(env.dialect, prefix, Number(m[1]) + 1));
}

/** Upsert keeping the larger `next`: scalar MAX(a, b) on SQLite, GREATEST(a, b) on Postgres. */
export function reserveSql(dialect: 'sqlite' | 'postgres', prefix: string, after: number) {
  return dialect === 'postgres'
    ? Prisma.sql`INSERT INTO "DocumentSequence" ("prefix", "next") VALUES (${prefix}, ${after}) ON CONFLICT ("prefix") DO UPDATE SET "next" = GREATEST("DocumentSequence"."next", ${after})`
    : Prisma.sql`INSERT INTO "DocumentSequence" ("prefix", "next") VALUES (${prefix}, ${after}) ON CONFLICT ("prefix") DO UPDATE SET "next" = MAX("DocumentSequence"."next", ${after})`;
}
