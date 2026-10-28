import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, ChevronDown, HelpCircle, MessageSquare, Settings, UserCircle2 } from 'lucide-react';
import { Logo } from '../components/Logo';
import { useAuth } from '../lib/auth';
import { t, useLocale } from '../lib/i18n';

export function TopBar() {
  const { me, branch, logout, switchBranch, can } = useAuth();
  const [locale, setLocale] = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <header className="flex h-12 items-center gap-4 border-b border-slate-200 bg-white px-4">
      <Link to="/dashboard"><Logo /></Link>
      <div className="flex-1" />
      <a className="btn-ghost" href="https://github.com" target="_blank" rel="noreferrer"><HelpCircle size={16} />{t('top.support')}</a>
      <a className="btn-ghost" href="mailto:feedback@example.com"><MessageSquare size={16} />{t('top.feedback')}</a>
      <button type="button" className="btn-ghost" title={t('top.notifications')}><Bell size={18} /></button>
      {can('settings.view') && <Link to="/settings" className="btn-ghost" title={t('top.settings')}><Settings size={18} /></Link>}
      <div className="relative" ref={ref}>
        <button type="button" className="btn-ghost" onClick={() => setOpen(o => !o)}>
          <UserCircle2 size={20} />
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-4">{me?.user.fullName}</span>
            <span className="block text-xs text-slate-500">{branch?.name}</span>
          </span>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg bg-white p-2 shadow-xl ring-1 ring-slate-200">
            {me && me.branches.length > 1 && (
              <div className="mb-2 border-b border-slate-100 pb-2">
                <div className="px-2 pb-1 text-xs text-slate-500">{t('top.branch')}</div>
                {me.branches.map(b => (
                  <button key={b.id} type="button" onClick={() => switchBranch(b.id)}
                    className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${b.id === branch?.id ? 'font-semibold text-brand-700' : ''}`}>
                    {b.name}
                  </button>
                ))}
              </div>
            )}
            <Link to="/change-password" className="block rounded px-2 py-1.5 text-sm hover:bg-slate-50" onClick={() => setOpen(false)}>{t('top.changePassword')}</Link>
            <div className="flex items-center justify-between px-2 py-1.5 text-sm">
              <span>{t('top.language')}</span>
              <span className="flex gap-1">
                {(['vi', 'en'] as const).map(l => (
                  <button key={l} type="button" onClick={() => setLocale(l)} className={`rounded px-2 py-0.5 text-xs ${locale === l ? 'bg-brand-700 text-white' : 'bg-slate-100'}`}>{l.toUpperCase()}</button>
                ))}
              </span>
            </div>
            <button type="button" onClick={logout} className="block w-full rounded px-2 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50">{t('top.logout')}</button>
          </div>
        )}
      </div>
    </header>
  );
}
