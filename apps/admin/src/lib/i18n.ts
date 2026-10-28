import { useSyncExternalStore } from 'react';
import { vi } from '../locales/vi';
import { en } from '../locales/en';

export type Locale = 'vi' | 'en';
const dicts: Record<Locale, Record<string, string>> = { vi, en };
const KEY = 'pd.locale';

function readLocale(): Locale {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; }
}

let current: Locale = typeof window === 'undefined' ? 'vi' : readLocale();
const listeners = new Set<() => void>();

/** Looks up a key in the active locale, falling back to Vietnamese, then to the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? vi[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function setLocale(l: Locale) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  listeners.forEach(f => f());
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const l = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
  return [l, setLocale];
}
