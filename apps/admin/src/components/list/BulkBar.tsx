import clsx from 'clsx';
import { t } from '../../lib/i18n';

export function BulkBar({ count, actions, onClear }: { count: number; actions: { label: string; onClick: () => void; danger?: boolean }[]; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="flex items-center gap-2 rounded-md bg-brand-50 px-3 py-1.5 text-sm ring-1 ring-brand-200">
      <span className="font-medium text-brand-800">{t('common.selected', { n: count })}</span>
      {actions.map(a => (
        <button key={a.label} type="button" onClick={a.onClick} className={clsx('rounded px-2 py-1 hover:bg-white', a.danger && 'text-rose-600')}>{a.label}</button>
      ))}
      <button type="button" className="ml-auto text-slate-500 hover:underline" onClick={onClear}>{t('common.close')}</button>
    </div>
  );
}
