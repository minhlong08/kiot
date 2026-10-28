import { forwardRef, useMemo, useState } from 'react';
import { ImageIcon, LayoutGrid, List, Search, X } from 'lucide-react';
import { formatVnd, normalizeVi } from '@pd/shared';
import type { CatalogProduct } from '../state/carts';
import type { Bootstrap, PosCustomer } from '../lib/types';

type Props = {
  boot: Bootstrap; catalog: CatalogProduct[]; customers: PosCustomer[]; customer: PosCustomer | null; priceBookId: number | null;
  onCustomer: (c: PosCustomer | null) => void; onPriceBook: (id: number | null) => void; onAdd: (p: CatalogProduct) => void;
};
const PAGE = 18;

export const RightPanel = forwardRef<HTMLInputElement, Props>(function RightPanel({ boot, catalog, customers, customer, priceBookId, onCustomer, onPriceBook, onAdd }, customerRef) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [grid, setGrid] = useState(true);
  const matches = useMemo(() => {
    const t = normalizeVi(q);
    if (!t) return [];
    return customers.filter(c => (c.searchText ?? normalizeVi(`${c.code} ${c.name} ${c.phone}`)).includes(t) || c.phone.includes(q.replace(/\D/g, '') || '¤')).slice(0, 8);
  }, [q, customers]);
  const products = useMemo(() => catalog.filter(p => p.sellable && (!group || p.groupId === group)), [catalog, group]);
  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const shown = products.slice(page * PAGE, page * PAGE + PAGE);
  const price = (p: CatalogProduct) => (priceBookId && p.bookPrices[priceBookId]) || p.price;

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {customer ? (
        <div className="flex items-center justify-between rounded-md border border-brand-500 bg-brand-50 px-3 py-2">
          <div><div className="font-semibold text-brand-800">{customer.name}</div><div className="text-xs text-slate-600">{customer.phone} · {customer.groupName || 'Khách thường'} · Điểm {formatVnd(customer.points)}{customer.debt ? ` · Nợ ${formatVnd(customer.debt)}` : ''}</div></div>
          <button type="button" aria-label="Bỏ chọn khách" onClick={() => onCustomer(null)}><X size={16} /></button>
        </div>
      ) : (
        <div className="relative">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input ref={customerRef} className="input pl-8" placeholder="Tìm khách hàng (F4)" value={q} onChange={e => setQ(e.target.value)} />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg bg-white shadow-xl ring-1 ring-slate-200">
              {matches.map(c => (
                <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onCustomer(c); setQ(''); }}>
                  <span className="font-medium">{c.name}</span><span className="block text-xs text-slate-500">{c.code} · {c.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <select className="input" aria-label="Bảng giá" value={priceBookId ?? ''} onChange={e => onPriceBook(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Bảng giá chung</option>
        {boot.priceBooks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {[{ id: null as number | null, name: 'Tất cả' }, ...boot.groups].map(g => (
          <button key={g.id ?? 0} type="button" onClick={() => { setGroup(g.id); setPage(0); }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${group === g.id ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-slate-200'}`}>{g.name}</button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-label="Dạng lưới" onClick={() => setGrid(true)} className={grid ? 'text-brand-700' : 'text-slate-400'}><LayoutGrid size={16} /></button>
        <button type="button" aria-label="Dạng danh sách" onClick={() => setGrid(false)} className={!grid ? 'text-brand-700' : 'text-slate-400'}><List size={16} /></button>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${grid ? 'grid grid-cols-3 content-start gap-2' : 'space-y-1'}`}>
        {shown.map(p => (
          <button key={p.id} type="button" onClick={() => onAdd(p)} className={`rounded-lg bg-white text-left ring-1 ring-slate-200 hover:ring-brand-500 ${grid ? 'p-2' : 'flex w-full items-center gap-2 p-1.5'}`}>
            <div className={`flex items-center justify-center overflow-hidden rounded bg-slate-100 ${grid ? 'mb-1 aspect-square w-full' : 'h-10 w-10 shrink-0'}`}>
              {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon size={20} className="text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-xs font-medium leading-tight">{p.name}</div>
              <div className="flex justify-between text-xs"><span className="font-semibold text-brand-700">{formatVnd(price(p))}</span>{p.onHand !== null && <span className={p.onHand > 0 ? 'text-slate-500' : 'text-rose-600'}>{p.onHand}</span>}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
        <span>{page + 1}/{pages}</span>
        <button type="button" className="btn" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>›</button>
      </div>
    </div>
  );
});
