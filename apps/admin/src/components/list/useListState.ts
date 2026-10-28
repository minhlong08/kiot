import { useCallback, useMemo, useState } from 'react';

type Primitive = string | number | boolean | string[];
export type ListState = { page: number; pageSize: number; search: string; sort?: string } & Record<string, Primitive | undefined>;

function readUrl(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function decode(raw: string, def: Primitive | undefined): Primitive {
  if (Array.isArray(def)) return raw ? raw.split(',') : [];
  if (typeof def === 'number') return Number(raw);
  if (typeof def === 'boolean') return raw === 'true';
  return raw;
}

/**
 * List filter/page/sort state, mirrored into the URL query string so links and reloads keep the view.
 * `query` is ready to pass to `api(path, { query })`.
 */
export function useListState<S extends Record<string, Primitive | undefined>>(defaults: S) {
  const base = { page: 1, pageSize: 15, search: '', sort: undefined as string | undefined, ...defaults };
  const [state, setState] = useState(() => {
    const url = readUrl();
    const out: Record<string, Primitive | undefined> = { ...base };
    for (const k of Object.keys(base)) {
      const raw = url.get(k);
      if (raw !== null) out[k] = decode(raw, (base as Record<string, Primitive | undefined>)[k]);
    }
    return out as typeof base;
  });

  const set = useCallback((patch: Partial<typeof base>) => {
    setState(prev => {
      const resetsPage = Object.keys(patch).some(k => k !== 'page' && k !== 'pageSize');
      const next = { ...prev, ...patch, ...(resetsPage && patch.page === undefined ? { page: 1 } : {}) };
      const url = new URL(window.location.href);
      for (const [k, v] of Object.entries(next)) {
        const def = (base as Record<string, unknown>)[k];
        const enc = Array.isArray(v) ? v.join(',') : v === undefined ? '' : String(v);
        const defEnc = Array.isArray(def) ? def.join(',') : def === undefined ? '' : String(def);
        if (enc === defEnc) url.searchParams.delete(k); else url.searchParams.set(k, enc);
      }
      window.history.replaceState(window.history.state, '', url);
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const q: Record<string, string | number | boolean | (string | number)[] | undefined> = {};
    for (const [k, v] of Object.entries(state)) q[k] = v;
    return q;
  }, [state]);

  return { state, set, query };
}
