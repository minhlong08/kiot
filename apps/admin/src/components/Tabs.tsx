import { useState, type ReactNode } from 'react';
import clsx from 'clsx';

export type Tab = { key: string; label: string; content: () => ReactNode };

export function Tabs({ tabs, initial, className }: { tabs: Tab[]; initial?: string; className?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  const current = tabs.find(t => t.key === active) ?? tabs[0];
  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 border-b border-slate-200 px-3">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === current.key} onClick={() => setActive(t.key)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', t.key === current.key ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.content()}</div>
    </div>
  );
}
