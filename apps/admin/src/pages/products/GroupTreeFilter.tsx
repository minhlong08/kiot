import { useState } from 'react';
import clsx from 'clsx';
import { normalizeVi } from '@pd/shared';
import { flattenGroups, type Group } from './useLookups';

type Props = { groups: Group[]; value: number[]; onChange: (ids: number[]) => void };

/** Single-select tree (subgroups are included by the API). Clicking the selected group clears it. */
export function GroupTreeFilter({ groups, value, onChange }: Props) {
  const [q, setQ] = useState('');
  const rows = flattenGroups(groups).filter(g => !q || normalizeVi(g.name).includes(normalizeVi(q)));
  return (
    <div className="space-y-1.5">
      <input className="input py-1" placeholder="Tìm nhóm hàng" value={q} onChange={e => setQ(e.target.value)} />
      <div className="max-h-64 overflow-y-auto">
        <button type="button" onClick={() => onChange([])} className={clsx('block w-full rounded px-2 py-1 text-left text-sm', !value.length ? 'bg-brand-50 font-medium text-brand-800' : 'hover:bg-slate-50')}>Tất cả</button>
        {rows.map(g => (
          <button key={g.id} type="button" onClick={() => onChange(value.includes(g.id) ? [] : [g.id])} style={{ paddingLeft: 8 + g.depth * 14 }}
            className={clsx('block w-full rounded py-1 pr-2 text-left text-sm', value.includes(g.id) ? 'bg-brand-50 font-medium text-brand-800' : 'hover:bg-slate-50')}>
            {g.name} <span className="text-xs text-slate-400">({g.productCount})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
