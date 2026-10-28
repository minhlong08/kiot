import { listQuerySchema, normalizeVi, type ListQuery } from '@pd/shared';

export type ParsedList = ListQuery & { skip: number; take: number; searchNorm: string | undefined };

export function parseList(query: unknown): ParsedList {
  const q = listQuerySchema.parse(query ?? {});
  const searchNorm = q.search?.trim() ? normalizeVi(q.search) : undefined;
  return { ...q, skip: (q.page - 1) * q.pageSize, take: q.pageSize, searchNorm };
}

/** Prisma orderBy from "field:dir", only for allowed fields. */
export function orderByOf(sort: string | undefined, allowed: string[], fallback: Record<string, 'asc' | 'desc'>) {
  if (!sort) return fallback;
  const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];
  return allowed.includes(field) ? { [field]: dir } : fallback;
}

/** Parses a date query param (ISO string) or returns undefined. */
export function dateParam(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Comma separated or repeated query param → string array. */
export function listParam(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = arr.map(String).map(s => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}
