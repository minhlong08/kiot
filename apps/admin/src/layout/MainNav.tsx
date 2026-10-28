import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ShoppingCart } from 'lucide-react';
import { NAV, type NavSection } from './nav';
import { t } from '../lib/i18n';

type Props = {
  can: (perm: string) => boolean;
  currentPath: string;
  renderLink: (to: string, label: string, className?: string) => ReactNode;
};

function visibleColumns(s: NavSection, can: Props['can']) {
  return (s.columns ?? []).map(c => ({ ...c, items: c.items.filter(i => can(i.perm)) })).filter(c => c.items.length);
}

function isActive(s: NavSection, path: string) {
  if (s.to) return path.startsWith(s.to);
  return (s.columns ?? []).some(c => c.items.some(i => path.startsWith(i.to)));
}

export function MainNav({ can, currentPath, renderLink }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <nav className="bg-brand-700 text-white" onMouseLeave={() => setOpen(null)}>
      <div className="flex items-center gap-1 px-4 h-11">
        {NAV.map(s => {
          if (s.to) {
            if (s.perm && !can(s.perm)) return null;
            return (
              <div key={s.key}>
                {renderLink(s.to, t(s.labelKey), clsx('nav-top', isActive(s, currentPath) && 'nav-top-active'))}
              </div>
            );
          }
          const cols = visibleColumns(s, can);
          if (!cols.length) return null;
          return (
            <div key={s.key} className="relative" onMouseEnter={() => setOpen(s.key)}>
              <button type="button" className={clsx('nav-top', isActive(s, currentPath) && 'nav-top-active')} onClick={() => setOpen(open === s.key ? null : s.key)}>
                {t(s.labelKey)}
              </button>
              {open === s.key && (
                <div className="absolute left-0 top-full z-40 mt-1 flex gap-2 rounded-lg bg-white p-3 text-slate-800 shadow-xl ring-1 ring-slate-200" onClick={() => setOpen(null)}>
                  {cols.map(c => (
                    <div key={c.titleKey} className="min-w-44 px-2">
                      <div className="mb-1 px-2 text-xs font-medium text-slate-500">{t(c.titleKey)}</div>
                      {c.items.map(i => <div key={i.to}>{renderLink(i.to, t(i.labelKey), 'block rounded px-2 py-2 text-sm hover:bg-brand-50 hover:text-brand-700')}</div>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex-1" />
        {can('pos.access') && (
          <a href="/sale/" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-accent-500 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-accent-400">
            <ShoppingCart size={16} /> {t('nav.sell')}
          </a>
        )}
      </div>
    </nav>
  );
}
