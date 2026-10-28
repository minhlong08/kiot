export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>;
type Init = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; query?: Query };

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onAuthError: ((code: string) => void) | null = null;
/** The app shell installs a handler that redirects on 401 / forced password change. */
export function setAuthErrorHandler(fn: (code: string) => void) { onAuthError = fn; }

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(`/api${path}${toQueryString(init.query)}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: init.body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  if (res.ok) {
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
  }
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try { body = await res.json(); } catch { /* non-JSON error */ }
  const code = body.error?.code ?? 'HTTP_' + res.status;
  if (res.status === 401 || code === 'PASSWORD_CHANGE_REQUIRED') onAuthError?.(code);
  throw new ApiError(res.status, code, body.error?.message ?? res.statusText, body.error?.details);
}

/** Downloads a file response (e.g. Excel export) using the browser. */
export async function download(path: string, query?: Query, filename = 'export.xlsx') {
  const blob = await api<Blob>(path, { query });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
