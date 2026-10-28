import { useEffect, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { CustomerForm } from './CustomerForm';

export type PickedCustomer = { id: number; code: string; name: string; phone: string; groupId: number | null; groupName: string; discountPercent: number; debt: number; points: number };

/** Customer search with inline create; used by orders and invoices. */
export function CustomerPicker({ value, onChange, disabled, placeholder = 'Tìm khách hàng (F4)' }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; disabled?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PickedCustomer[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setRows([]); return; }
    const t = setTimeout(() => api<PickedCustomer[]>('/customers/lookup', { query: { q } }).then(setRows, () => setRows([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
        <span><b className="text-brand-700">{value.name}</b> <span className="text-xs text-slate-500">{value.phone} · Điểm {formatVnd(value.points)}{value.debt ? ` · Nợ ${formatVnd(value.debt)}` : ''}</span></span>
        {!disabled && <button type="button" aria-label="Bỏ chọn khách hàng" onClick={() => onChange(null)}><X size={14} /></button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="input pl-8 pr-8" placeholder={placeholder} value={q} disabled={disabled} onChange={e => setQ(e.target.value)} />
      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" aria-label="Thêm khách hàng" onClick={() => setCreating(true)}><Plus size={16} /></button>
      {rows.length > 0 && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-lg bg-white shadow-xl ring-1 ring-slate-200">
          {rows.map(c => (
            <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange(c); setQ(''); setRows([]); }}>
              <div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c.code} · {c.phone}</div>
            </button>
          ))}
        </div>
      )}
      <CustomerForm value={creating ? { name: /^\d+$/.test(q) ? '' : q, phone: /^\d+$/.test(q) ? q : '' } : null} onClose={() => setCreating(false)}
        onSaved={async c => onChange((await api<PickedCustomer[]>('/customers/lookup', { query: { q: c.code } }))[0] ?? null)} />
    </div>
  );
}
