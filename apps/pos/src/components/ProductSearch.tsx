import { forwardRef, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatVnd, normalizeVi } from '@pd/shared';
import type { CatalogProduct } from '../state/carts';

type Hit = { product: CatalogProduct; unitId: number | null; label: string; code: string; price: number };

/** Find a sellable product (or unit) by exact code/barcode first, then by name. */
export function findExact(catalog: CatalogProduct[], text: string): Hit | null {
  const t = text.trim();
  for (const p of catalog) {
    if (!p.sellable) continue;
    if (p.code === t || p.barcode === t) return { product: p, unitId: null, label: p.name, code: p.code, price: p.price };
    const u = p.units.find(x => x.code === t || x.barcode === t);
    if (u) return { product: p, unitId: u.id, label: `${p.name} (${u.name})`, code: u.code, price: u.price };
  }
  return null;
}

type Props = { catalog: CatalogProduct[]; onPick: (p: CatalogProduct, unitId: number | null) => void; onEmptyEnter?: () => void };

/** Scanner-friendly: a barcode scanner types the code fast and presses Enter. */
export const ProductSearch = forwardRef<HTMLInputElement, Props>(function ProductSearch({ catalog, onPick, onEmptyEnter }, ref) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo<Hit[]>(() => {
    const t = normalizeVi(q);
    if (!t) return [];
    return catalog.filter(p => p.sellable && p.searchText.includes(t)).slice(0, 8).flatMap(p => [
      { product: p, unitId: null, label: p.name, code: p.code, price: p.price },
      ...p.units.map(u => ({ product: p, unitId: u.id, label: `${p.name} (${u.name})`, code: u.code, price: u.price })),
    ]).slice(0, 10);
  }, [q, catalog]);
  const pick = (h: Hit) => { onPick(h.product, h.unitId); setQ(''); setActive(0); };
  return (
    <div className="relative w-full max-w-md">
      <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={ref} className="input pl-8 text-slate-800" placeholder="Tìm hàng hóa (F3)" value={q} autoComplete="off"
        onChange={e => { setQ(e.target.value); setActive(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          if (e.key === 'Escape') setQ('');
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!q.trim()) return onEmptyEnter?.();
            const exact = findExact(catalog, q);
            const h = exact ?? (hits.length === 1 ? hits[0] : hits[active]);
            if (h) pick(h);
          }
        }} />
      {q.trim() && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-96 overflow-y-auto rounded-lg bg-white text-slate-800 shadow-xl ring-1 ring-slate-200">
          {!hits.length && <div className="px-3 py-3 text-sm text-slate-400">Không tìm thấy hàng hóa</div>}
          {hits.map((h, i) => (
            <button key={`${h.product.id}-${h.unitId}`} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
              <span><span className="font-medium">{h.label}</span><span className="block text-xs text-slate-500">{h.code}{h.product.onHand !== null ? ` · Tồn ${h.product.onHand}` : ''}</span></span>
              <span className="num">{formatVnd(h.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
