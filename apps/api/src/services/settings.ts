import { settingsSchema, type Settings } from '@pd/shared';
import type { Tx } from '../db';
import { audit, type AuditCtx } from './audit';

/** Each top-level settings section is stored as one JSON row keyed by section name. */
export async function getSettings(tx: Tx): Promise<Settings> {
  const rows = await tx.setting.findMany();
  const raw: Record<string, unknown> = {};
  for (const r of rows) {
    try { raw[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt row, defaults apply */ }
  }
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch && typeof patch === 'object' && !Array.isArray(patch) && base && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
    return out;
  }
  return patch === undefined ? base : patch;
}

export async function updateSettings(tx: Tx, ctx: AuditCtx, patch: unknown): Promise<Settings> {
  const before = await getSettings(tx);
  const next = settingsSchema.parse(deepMerge(before, patch));
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    const value = JSON.stringify(next[key]);
    if (value !== JSON.stringify(before[key])) {
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }
  await audit(tx, ctx, { action: 'settings', entity: 'Setting', entityId: 'app', summary: 'Cập nhật thiết lập', before, after: next });
  return next;
}
