export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const qs = init.query ? '?' + new URLSearchParams(Object.entries(init.query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const res = await fetch(`/api${path}${qs}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), credentials: 'include',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.ok) return res.json() as Promise<T>;
  let body: { error?: { code?: string; message?: string } } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = `/login?next=${encodeURIComponent('/sale/')}`;
  throw new ApiError(res.status, body.error?.code ?? `HTTP_${res.status}`, body.error?.message ?? res.statusText);
}
