import { useSyncExternalStore } from 'react';
import clsx from 'clsx';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const id = ++seq;
  toasts = [...toasts, { id, text, kind }];
  emit();
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit(); }, kind === 'error' ? 6000 : 3000);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

export function Toaster() {
  const list = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => toasts);
  return (
    <div className="pointer-events-none fixed right-4 top-14 z-[60] flex flex-col gap-2">
      {list.map(t => (
        <div key={t.id} role="status" className={clsx('pointer-events-auto rounded-md px-4 py-2 text-sm text-white shadow-lg', t.kind === 'ok' ? 'bg-brand-700' : 'bg-rose-600')}>{t.text}</div>
      ))}
    </div>
  );
}
