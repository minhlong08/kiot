import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { SupplierForm } from '../suppliers/SupplierForm';

export type PickedSupplier = { id: number; code: string; name: string; phone?: string; debt?: number };

export function SupplierPicker({ value, onChange, disabled }: { value: PickedSupplier | null; onChange: (s: PickedSupplier | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PickedSupplier[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setRows([]); return; }
    const t = setTimeout(() => api<{ items: PickedSupplier[] }>('/suppliers', { query: { search: q, pageSize: 15 } }).then(r => setRows(r.items), () => setRows([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
        <span><b className="text-brand-700">{value.name}</b>{value.debt ? <span className="ml-2 text-xs text-slate-500">Nợ: {formatVnd(value.debt)}</span> : null}</span>
        {!disabled && <button type="button" aria-label="Bỏ chọn nhà cung cấp" onClick={() => onChange(null)}><X size={14} /></button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="input pl-8 pr-8" placeholder="Tìm nhà cung cấp" value={q} disabled={disabled} onChange={e => setQ(e.target.value)} />
      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" aria-label="Thêm nhà cung cấp" onClick={() => setCreating(true)}><Plus size={16} /></button>
      {rows.length > 0 && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-lg bg-white shadow-xl ring-1 ring-slate-200">
          {rows.map(s => (
            <button key={s.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange(s); setQ(''); setRows([]); }}>
              <div className="font-medium">{s.name}</div><div className="text-xs text-slate-500">{s.code}{s.phone ? ` · ${s.phone}` : ''}</div>
            </button>
          ))}
        </div>
      )}
      <SupplierForm value={creating ? { name: q } : null} onClose={() => setCreating(false)} onSaved={s => onChange(s)} />
    </div>
  );
}
