import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';

export type LookupRow = {
  productId: number; unitId: number | null; code: string; barcode?: string | null; name: string; type?: string; unitName: string; conversion: number;
  price: number; cost?: number; onHand: number | null; imageUrl?: string | null; loyaltyEnabled?: boolean; points?: number | null; vatRate?: number | null; orderNoteTemplate?: string;
};

type Props = {
  onPick: (row: LookupRow) => void;
  placeholder?: string;
  /** Only items sold directly (POS). */
  pos?: boolean;
  /** Focus with F3. */
  hotkey?: boolean;
  exclude?: (row: LookupRow) => boolean;
  className?: string;
};

/**
 * Search-as-you-type product lookup. A barcode scanner types fast and ends with Enter:
 * Enter picks the exact code/barcode match (or the only result) immediately.
 */
export function ProductPicker({ onPick, placeholder = 'Tìm hàng hóa theo mã hoặc tên (F3)', pos, hotkey, exclude, className }: Props) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F3') { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  async function search(text: string) {
    const id = ++seq.current;
    if (!text.trim()) { setRows([]); return []; }
    const res = await api<LookupRow[]>('/products/lookup', { query: { q: text.trim(), pos: pos ? 1 : undefined } }).catch(() => []);
    const filtered = exclude ? res.filter(r => !exclude(r)) : res;
    if (id === seq.current) { setRows(filtered); setActive(0); setOpen(true); }
    return filtered;
  }

  useEffect(() => {
    const t = setTimeout(() => void search(q), 200);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(r: LookupRow) {
    onPick(r);
    setQ('');
    setRows([]);
    setOpen(false);
    input.current?.focus();
  }

  async function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      const text = q.trim();
      const res = rows.length && open ? rows : await search(text);
      const exact = res.find(r => r.code === text || r.barcode === text);
      const chosen = exact ?? (res.length === 1 ? res[0] : res[active]);
      if (chosen) pick(chosen);
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={input} className="input pl-8" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
        onFocus={() => rows.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} autoComplete="off" />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-lg bg-white shadow-xl ring-1 ring-slate-200">
          {rows.length === 0 && <div className="px-3 py-3 text-sm text-slate-400">Không tìm thấy hàng hóa</div>}
          {rows.map((r, i) => (
            <button key={`${r.productId}-${r.unitId ?? 0}`} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(r)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}{r.unitId ? ` (${r.unitName})` : ''}</div>
                <div className="text-xs text-slate-500">{r.code}{r.onHand !== null ? ` · Tồn: ${formatVnd(r.onHand)}` : ''}</div>
              </div>
              <div className="num text-sm">{formatVnd(r.price)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
