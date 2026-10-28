import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES } from '@pd/shared';
import { t } from '../../lib/i18n';

type Props = { page: number; pageSize: number; total: number; noun?: string; onChange: (page: number, pageSize: number) => void };

export function Pagination({ page, pageSize, total, noun = '', onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30';
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
      <label className="flex items-center gap-2">
        {t('common.show')}
        <select className="rounded border border-slate-300 px-1 py-0.5" value={pageSize} onChange={e => onChange(1, Number(e.target.value))}>
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} {t('common.rows')}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(1, pageSize)} aria-label="Trang đầu"><ChevronFirst size={16} /></button>
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(page - 1, pageSize)} aria-label="Trang trước"><ChevronLeft size={16} /></button>
        <span className="min-w-8 rounded border border-slate-300 px-2 text-center">{page}</span>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onChange(page + 1, pageSize)} aria-label="Trang sau"><ChevronRight size={16} /></button>
        <button type="button" className={btn} disabled={page >= pages} onClick={() => onChange(pages, pageSize)} aria-label="Trang cuối"><ChevronLast size={16} /></button>
      </div>
      <span className="ml-auto">{`${from} - ${to} ${t('common.of')} ${total}${noun ? ' ' + noun : ''}`}</span>
    </div>
  );
}
