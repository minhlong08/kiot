import type { Tx } from '../db';

export type AuditCtx = { userId: number | null; branchId: number | null; ip: string };
export type AuditAction = 'create' | 'update' | 'delete' | 'cancel' | 'complete' | 'login' | 'logout' | 'settings' | 'import';

export type AuditEntry = {
  action: AuditAction;
  entity: string;
  entityId: string | number;
  entityCode?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Top-level keys whose JSON value differs: { key: [before, after] }. */
export function diffObjects(before: unknown, after: unknown): Record<string, [unknown, unknown]> {
  const b = asRecord(before), a = asRecord(after);
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (key === 'updatedAt' || key === 'createdAt' || key === 'passwordHash') continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) out[key] = [b[key] ?? null, a[key] ?? null];
  }
  return out;
}

export async function audit(tx: Tx, ctx: AuditCtx, e: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: ctx.userId,
      branchId: ctx.branchId,
      ip: ctx.ip,
      action: e.action,
      entity: e.entity,
      entityId: String(e.entityId),
      entityCode: e.entityCode ?? '',
      summary: e.summary,
      diff: JSON.stringify(diffObjects(e.before, e.after)),
    },
  });
}
