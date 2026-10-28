import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, HelpCircle, Plus, Search, Upload } from 'lucide-react';
import { t } from '../../lib/i18n';

type MenuItem = { label: string; onClick: () => void };

type Props = {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  createMenu?: MenuItem[];
  createLabel?: string;
  onCreate?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  extra?: ReactNode;
};

export function ListToolbar(p: Props) {
  const [text, setText] = useState(p.search);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setText(p.search), [p.search]);
  useEffect(() => {
    const id = setTimeout(() => { if (text !== p.search) p.onSearch(text); }, 300);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-56 flex-1">
        <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-8" placeholder={p.placeholder ?? t('common.search')} value={text} onChange={e => setText(e.target.value)} aria-label={t('common.search')} />
      </label>
      <div className="flex-1" />
      {p.extra}
      {p.createMenu ? (
        <div className="relative" ref={ref}>
          <button type="button" className="btn-primary" onClick={() => setMenu(m => !m)}><Plus size={16} />{p.createLabel ?? t('common.create')}<ChevronDown size={14} /></button>
          {menu && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-lg bg-white py-1 shadow-xl ring-1 ring-slate-200">
              {p.createMenu.map(i => (
                <button key={i.label} type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setMenu(false); i.onClick(); }}>{i.label}</button>
              ))}
            </div>
          )}
        </div>
      ) : p.onCreate ? (
        <button type="button" className="btn-primary" onClick={p.onCreate}><Plus size={16} />{p.createLabel ?? t('common.create')}</button>
      ) : null}
      {p.onImport && <button type="button" className="btn" onClick={p.onImport}><Upload size={16} />{t('common.import')}</button>}
      {p.onExport && <button type="button" className="btn" onClick={p.onExport}><Download size={16} />{t('common.export')}</button>}
      <button type="button" className="btn-ghost" title={t('common.help')}><HelpCircle size={16} /></button>
    </div>
  );
}
