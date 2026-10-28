import { minutesOf } from '@pd/shared';

export type Shift = { id: number; name: string; start: string; end: string; breakMinutes: number; color: string; isActive: boolean };
export const DAY_NAMES = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Monday of the local (VN) week containing `date` (default: today). */
export function mondayOf(date?: string) {
  const d = date ?? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * A local HH:mm typed for a shift on `date` as an ISO instant: the shift day or the next day,
 * whichever lands nearer the shift window (21:58 before a 22:00 shift stays, 06:40 after it ends rolls over).
 */
export function toInstant(date: string, hhmm: string, shift: { start: string; end: string }) {
  const at = (d: string) => Date.parse(`${d}T${hhmm}:00+07:00`);
  const start = Date.parse(`${date}T${shift.start}:00+07:00`);
  const end = Date.parse(`${minutesOf(shift.end) <= minutesOf(shift.start) ? addDays(date, 1) : date}T${shift.end}:00+07:00`);
  const dist = (t: number) => (t < start ? start - t : t > end ? t - end : 0);
  const [a, b] = [at(date), at(addDays(date, 1))];
  return new Date(dist(b) < dist(a) ? b : a).toISOString();
}
/** ISO instant → local HH:mm. */
export const localTime = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(11, 16) : '');
export const hoursText = (min: number) => (min ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : '');
