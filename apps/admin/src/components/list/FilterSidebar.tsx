import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function FilterSidebar({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="w-full space-y-3 lg:w-60 lg:shrink-0">
      <h1 className="text-xl font-bold text-slate-800">{title}</h1>
      {children}
    </aside>
  );
}

export function FilterSection({ title, action, children, defaultOpen = true }: { title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card p-3">
      <div className="flex items-center justify-between">
        <button type="button" className="flex flex-1 items-center justify-between text-sm font-semibold" onClick={() => setOpen(o => !o)}>
          {title}
          {!action && (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
        </button>
        {action}
      </div>
      {open && <div className="mt-2 space-y-1.5">{children}</div>}
    </section>
  );
}
