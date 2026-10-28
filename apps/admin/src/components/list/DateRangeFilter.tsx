import { DATE_PRESETS, dateRangePreset, type DatePreset } from '@pd/shared';
import { t } from '../../lib/i18n';

/** Value: a preset key, or "custom:YYYY-MM-DD:YYYY-MM-DD" (local dates, end inclusive). */
export type DateRangeValue = string;

export function resolveDateRange(v: DateRangeValue | undefined): { from?: string; to?: string } {
  if (!v || v === 'all') return {};
  if (v.startsWith('custom:')) {
    const [, a, b] = v.split(':');
    const from = a ? new Date(`${a}T00:00:00+07:00`).toISOString() : undefined;
    const to = b ? new Date(new Date(`${b}T00:00:00+07:00`).getTime() + 86400_000).toISOString() : undefined;
    return { from, to };
  }
  const r = dateRangePreset(v as DatePreset);
  return { from: r.from?.toISOString(), to: r.to?.toISOString() };
}

type Props = { value: DateRangeValue; onChange: (v: DateRangeValue) => void; presets?: DatePreset[] };

export function DateRangeFilter({ value, onChange, presets = ['today', 'thisWeek', 'thisMonth', 'all'] }: Props) {
  const isCustom = value.startsWith('custom:');
  const [, a = '', b = ''] = isCustom ? value.split(':') : [];
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={!isCustom} onChange={() => onChange(presets[presets.length - 1])} />
        <select className="input py-1" value={isCustom ? '' : value} disabled={isCustom} onChange={e => onChange(e.target.value)}>
          {(isCustom ? [''] : []).map(x => <option key={x} value="" />)}
          {DATE_PRESETS.filter(p => presets.includes(p) || p === value).map(p => <option key={p} value={p}>{t(`date.${p}`)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" checked={isCustom} onChange={() => onChange('custom::')} />
        {t('date.custom')}
      </label>
      {isCustom && (
        <div className="grid grid-cols-2 gap-1 pl-6">
          <input type="date" className="input px-1 py-1 text-xs" value={a} onChange={e => onChange(`custom:${e.target.value}:${b}`)} aria-label={t('common.from')} />
          <input type="date" className="input px-1 py-1 text-xs" value={b} onChange={e => onChange(`custom:${a}:${e.target.value}`)} aria-label={t('common.to')} />
        </div>
      )}
    </div>
  );
}
