export const TZ = 'Asia/Ho_Chi_Minh';
// Vietnam has no daylight saving time, so a fixed +7h offset is exact.
const OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86400_000;

export type DatePreset =
  | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'
  | 'thisQuarter' | 'thisYear' | 'all';

export const DATE_PRESETS: DatePreset[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'all'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock parts in Vietnam time, read from a shifted UTC date. */
function local(d: Date | string): Date {
  return new Date(new Date(d).getTime() + OFFSET_MS);
}

export function formatDate(d: Date | string): string {
  const l = local(d);
  return `${pad(l.getUTCDate())}/${pad(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}`;
}

export function formatDateTime(d: Date | string): string {
  const l = local(d);
  return `${formatDate(d)} ${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
}

/** UTC instant of local midnight for the given local Y/M/D (month may overflow). */
export function localMidnight(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day) - OFFSET_MS);
}

/** Start of the local day containing `d`. */
export function startOfLocalDay(d: Date): Date {
  const l = local(d);
  return localMidnight(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
}

/** `to` is exclusive. */
export function dateRangePreset(p: DatePreset, now: Date = new Date()): { from: Date | null; to: Date | null } {
  const l = local(now);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate();
  const weekday = (l.getUTCDay() + 6) % 7; // Monday = 0
  switch (p) {
    case 'today': return { from: localMidnight(y, m, d), to: localMidnight(y, m, d + 1) };
    case 'yesterday': return { from: localMidnight(y, m, d - 1), to: localMidnight(y, m, d) };
    case 'thisWeek': return { from: localMidnight(y, m, d - weekday), to: localMidnight(y, m, d - weekday + 7) };
    case 'lastWeek': return { from: localMidnight(y, m, d - weekday - 7), to: localMidnight(y, m, d - weekday) };
    case 'thisMonth': return { from: localMidnight(y, m, 1), to: localMidnight(y, m + 1, 1) };
    case 'lastMonth': return { from: localMidnight(y, m - 1, 1), to: localMidnight(y, m, 1) };
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: localMidnight(y, q, 1), to: localMidnight(y, q + 3, 1) };
    }
    case 'thisYear': return { from: localMidnight(y, 0, 1), to: localMidnight(y + 1, 0, 1) };
    case 'all': return { from: null, to: null };
  }
}

export { DAY_MS };
