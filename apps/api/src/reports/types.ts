import type { Tx } from '../db';
import type { AuthUser } from '../plugins/auth';

export type Column = { key: string; label: string; money?: boolean; number?: boolean; percent?: boolean; /** Needs cost.view. */ cost?: boolean };
export type Chart = { type: 'bar' | 'hbar' | 'line'; labels: string[]; series: { name: string; values: number[] }[] };
export type Report = { title: string; columns: Column[]; rows: Record<string, unknown>[]; totals: Record<string, number>; chart?: Chart };
export type ReportCtx = { db: Tx; user: AuthUser; from: Date; to: Date; branchId: number | null; q: Record<string, unknown> };
export type ReportBuilder = (ctx: ReportCtx) => Promise<Report>;

export const REPORTS = new Map<string, ReportBuilder>();
export const register = (name: string, b: ReportBuilder) => REPORTS.set(name, b);

/** Sum of the numeric columns (except percentages) over rows. */
export function totalsOf(columns: Column[], rows: Record<string, unknown>[]) {
  const t: Record<string, number> = {};
  for (const c of columns) if ((c.money || c.number) && !c.percent) t[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
  return t;
}
export const margin = (profit: number, revenue: number) => (revenue ? Math.round((profit / revenue) * 1000) / 10 : 0);

/** Removes cost-derived columns and values for users without cost.view. */
export function stripCost(r: Report, canSeeCost: boolean): Report {
  if (canSeeCost) return r;
  const hidden = r.columns.filter(c => c.cost).map(c => c.key);
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !hidden.includes(k)));
  return {
    ...r, columns: r.columns.filter(c => !c.cost), rows: r.rows.map(drop), totals: drop(r.totals) as Record<string, number>,
    chart: r.chart && { ...r.chart, series: r.chart.series.filter(s => !/lợi nhuận|giá vốn/i.test(s.name)) },
  };
}
