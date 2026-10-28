import { formatCode } from '@pd/shared';
import type { Tx } from '../db';

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
  const after = Number(m[1]) + 1;
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("prefix", "next") VALUES (${prefix}, ${after})
    ON CONFLICT ("prefix") DO UPDATE SET "next" = MAX("DocumentSequence"."next", ${after})`;
}
