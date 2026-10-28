const TZ = 7 * 3600_000;
const local = (d: Date) => new Date(d.getTime() + TZ);

/** Bucket of an instant in Vietnam time: day 'YYYY-MM-DD', hour '00'..'23', weekday '1'(Mon)..'7'(Sun), month 'YYYY-MM'. */
export function bucketKey(d: Date, by: 'day' | 'hour' | 'weekday' | 'month'): string {
  const l = local(d);
  if (by === 'day') return l.toISOString().slice(0, 10);
  if (by === 'month') return l.toISOString().slice(0, 7);
  if (by === 'hour') return String(l.getUTCHours()).padStart(2, '0');
  return String(((l.getUTCDay() + 6) % 7) + 1);
}
export const WEEKDAY_LABELS: Record<string, string> = { 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7', 7: 'Chủ nhật' };

/** The same local day-of-month and time one month earlier, clamped to that month's last day. */
export function sameTimeLastMonth(now: Date): Date {
  const l = local(now);
  const y = l.getUTCFullYear(), m = l.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = Date.UTC(y, m - 1, Math.min(l.getUTCDate(), lastDay), l.getUTCHours(), l.getUTCMinutes(), l.getUTCSeconds(), l.getUTCMilliseconds());
  return new Date(t - TZ);
}

/** The period of equal length right before [from, to). */
export function previousRange(r: { from: Date; to: Date }) {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: new Date(r.from) };
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/** Sums numeric `fields` per key; adds a `count` of facts; rows sorted by key. */
export function groupFacts<T, F extends keyof T & string>(facts: T[], keyOf: (f: T) => string, fields: F[]) {
  const map = new Map<string, Record<string, number> & { key: string; count: number }>();
  for (const f of facts) {
    const k = keyOf(f);
    let row = map.get(k);
    if (!row) { row = { key: k, count: 0 } as Record<string, number> & { key: string; count: number }; for (const x of fields) row[x] = 0; map.set(k, row); }
    for (const x of fields) row[x] += Number(f[x]) || 0;
    row.count++;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) as ({ key: string; count: number } & Record<F, number>)[];
}

export const PERIODS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'last7days', 'thisMonth', 'lastMonth', 'last30days', 'thisYear'] as const;
export type PeriodName = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<PeriodName, string> = {
  today: 'Hôm nay', yesterday: 'Hôm qua', thisWeek: 'Tuần này', lastWeek: 'Tuần trước', last7days: '7 ngày qua',
  thisMonth: 'Tháng này', lastMonth: 'Tháng trước', last30days: '30 ngày qua', thisYear: 'Năm nay',
};

/** A named period as a UTC range [from, to) of whole Vietnam-time days. */
export function periodRange(name: PeriodName, now = new Date()) {
  const l = local(now);
  const day = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - TZ;
  const D = 86400_000;
  const dow = (l.getUTCDay() + 6) % 7;
  const month = (offset: number) => Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + offset, 1) - TZ;
  const [from, to] = ({
    today: [day, day + D], yesterday: [day - D, day], thisWeek: [day - dow * D, day - dow * D + 7 * D], lastWeek: [day - (dow + 7) * D, day - dow * D],
    last7days: [day - 6 * D, day + D], thisMonth: [month(0), month(1)], lastMonth: [month(-1), month(0)], last30days: [day - 29 * D, day + D],
    thisYear: [Date.UTC(l.getUTCFullYear(), 0, 1) - TZ, Date.UTC(l.getUTCFullYear() + 1, 0, 1) - TZ],
  } as Record<PeriodName, [number, number]>)[name];
  return { from: new Date(from), to: new Date(to) };
}
