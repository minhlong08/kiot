import { createHash } from 'node:crypto';
import { Prisma, type Db, type Tx } from '../db';
import { env } from '../env';

export const BACKUP_APP = 'phuongdong-pos';
/** Sessions are never backed up or restored (they belong to the running server). */
const SKIP = new Set(['Session']);
/** Schema order: parents are declared before the tables that point at them. */
export const MODELS = (Object.values(Prisma.ModelName) as string[]).filter(m => !SKIP.has(m));
const fieldsOf = (m: string) => Object.keys((Prisma as unknown as Record<string, Record<string, string>>)[`${m}ScalarFieldEnum`] ?? {});
/** Fingerprint of the table/column layout: a backup only restores into the same layout. */
export const BACKUP_VERSION = createHash('sha1').update(MODELS.map(m => `${m}(${fieldsOf(m).join(',')})`).join(';')).digest('hex').slice(0, 12);

type Delegate = { findMany(a?: object): Promise<Record<string, unknown>[]>; deleteMany(a?: object): Promise<unknown>; createMany(a: { data: object[] }): Promise<unknown> };
const delegate = (tx: Tx, m: string) => (tx as unknown as Record<string, Delegate>)[m[0].toLowerCase() + m.slice(1)];

export type BackupDoc = { app: string; version: string; createdAt: string; tables: Record<string, Record<string, unknown>[]> };

export async function exportAll(db: Tx): Promise<BackupDoc> {
  const tables: BackupDoc['tables'] = {};
  for (const m of MODELS) tables[m] = await delegate(db, m).findMany();
  return { app: BACKUP_APP, version: BACKUP_VERSION, createdAt: new Date().toISOString(), tables };
}

/** Replaces every table's rows with the document's, in one transaction (all or nothing). */
export async function importAll(db: Db, doc: BackupDoc) {
  await db.$transaction(async tx => {
    // Deleting users cascades to their sessions: keep them and put back those whose user still exists.
    const sessions = await tx.session.findMany();
    for (const m of [...MODELS].reverse()) await delegate(tx, m).deleteMany();
    for (const m of MODELS) {
      const rows = doc.tables[m] ?? [];
      for (let i = 0; i < rows.length; i += 500) await delegate(tx, m).createMany({ data: rows.slice(i, i + 500) });
    }
    const users = new Set((await tx.user.findMany({ select: { id: true } })).map(u => u.id));
    const keep = sessions.filter(x => users.has(x.userId));
    if (keep.length) await tx.session.createMany({ data: keep });
    if (env.dialect === 'postgres') {
      // Explicit ids were inserted: move each serial sequence past the restored maximum.
      for (const m of MODELS) if (fieldsOf(m).includes('id')) await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${m}"', 'id'), COALESCE((SELECT MAX("id") FROM "${m}"), 0) + 1, false)`);
    }
  }, { timeout: 120_000, maxWait: 10_000 });
}

/** Empties every table, sessions included. */
export async function wipeAll(db: Db) {
  await db.$transaction(async tx => {
    await tx.session.deleteMany();
    for (const m of [...MODELS].reverse()) await delegate(tx, m).deleteMany();
  }, { timeout: 120_000 });
}
