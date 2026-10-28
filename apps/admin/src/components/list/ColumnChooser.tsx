import { useEffect, useRef, useState } from 'react';
import { Columns3 } from 'lucide-react';
import { t } from '../../lib/i18n';

type ColLike = { key: string; header: string; hiddenByDefault?: boolean };

function load(tableId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`cols:${tableId}`);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/** Visible column keys, persisted per table in localStorage (best effort). */
export function useColumnVisibility(tableId: string, columns: ColLike[]) {
  const [hidden, setHidden] = useState<string[]>(() => load(tableId) ?? columns.filter(c => c.hiddenByDefault).map(c => c.key));
  const visible = new Set(columns.map(c => c.key).filter(k => !hidden.includes(k)));
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
    setHidden(next);
    try { localStorage.setItem(`cols:${tableId}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return { visible, toggle };
}

export function ColumnChooser({ columns, visible, onToggle }: { columns: ColLike[]; visible: Set<string>; onToggle: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" title={t('common.columns')} className="rounded p-1 text-slate-500 hover:bg-white" onClick={() => setOpen(o => !o)}>
        <Columns3 size={16} />
      </button>
      {open && (
        <div data-testid="column-chooser" className="absolute right-0 z-30 mt-1 grid w-80 grid-cols-2 gap-1 rounded-lg bg-white p-3 shadow-xl ring-1 ring-slate-200">
          {columns.map(c => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)} aria-label={c.header} />
              {c.header}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
