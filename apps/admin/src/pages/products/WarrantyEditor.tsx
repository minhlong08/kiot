import { Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '../../components/Field';
import type { WarrantyDraft } from './formTypes';

function Section({ kind, title, items, all, onChange }: { kind: WarrantyDraft['kind']; title: string; items: WarrantyDraft[]; all: WarrantyDraft[]; onChange: (v: WarrantyDraft[]) => void }) {
  const update = (w: WarrantyDraft, patch: Partial<WarrantyDraft>) => onChange(all.map(x => (x === w ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {items.map((w, i) => (
        <div key={i} className="flex gap-2">
          <input className="input flex-1" placeholder={kind === 'warranty' ? 'VD: Bảo hành chính hãng' : 'VD: Vệ sinh định kỳ'} value={w.name} onChange={e => update(w, { name: e.target.value })} />
          <NumberInput className="w-20" value={w.duration} onChange={v => update(w, { duration: Math.max(1, Math.round(v)) })} />
          <select className="input w-28" value={w.durationUnit} onChange={e => update(w, { durationUnit: e.target.value as WarrantyDraft['durationUnit'] })}>
            <option value="day">Ngày</option><option value="month">Tháng</option><option value="year">Năm</option>
          </select>
          <button type="button" className="btn-ghost" aria-label="Xóa mốc" onClick={() => onChange(all.filter(x => x !== w))}><Trash2 size={14} /></button>
        </div>
      ))}
      {!items.length && <div className="text-sm text-slate-400">{kind === 'warranty' ? 'Chưa có bảo hành nào' : 'Chưa có bảo trì nào'}</div>}
      <button type="button" className="btn" onClick={() => onChange([...all, { kind, name: '', duration: 12, durationUnit: 'month' }])}><Plus size={14} />Thêm mốc</button>
    </div>
  );
}

export function WarrantyEditor({ value, onChange }: { value: WarrantyDraft[]; onChange: (v: WarrantyDraft[]) => void }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section kind="warranty" title="Bảo hành" items={value.filter(w => w.kind === 'warranty')} all={value} onChange={onChange} />
      <Section kind="maintenance" title="Bảo trì định kỳ" items={value.filter(w => w.kind === 'maintenance')} all={value} onChange={onChange} />
    </div>
  );
}
