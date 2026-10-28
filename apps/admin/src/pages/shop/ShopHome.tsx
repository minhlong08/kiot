import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useShopInfo } from './ShopLayout';

type Item = { id: number; name: string; price: number; maxPrice: number; imageUrl: string | null; inStock: boolean };

export const priceText = (min: number, max: number) => (max > min ? `${formatVnd(min)} – ${formatVnd(max)} đ` : `${formatVnd(min)} đ`);
export const Placeholder = () => <div className="grid h-full w-full place-items-center bg-stone-100 text-stone-300"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7l4-3h8l4 3-3 3v10H7V10z" /></svg></div>;

export function ShopHome() {
  const info = useShopInfo();
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const groups = useQuery({ queryKey: ['shop', 'groups'], queryFn: () => api<{ id: number; name: string }[]>('/shop/groups') });
  const list = useQuery({ queryKey: ['shop', 'products', search, groupId, page], queryFn: () => api<{ items: Item[]; total: number }>('/shop/products', { query: { search, groupId: groupId ?? undefined, page, pageSize: 24 } }) });
  const pages = Math.ceil((list.data?.total ?? 0) / 24);
  return (
    <div className="space-y-5">
      {info.data?.intro && <p className="max-w-2xl text-stone-600">{info.data.intro}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="w-full rounded-full border border-stone-300 bg-white px-4 py-2 sm:max-w-xs" placeholder="Tìm sản phẩm" aria-label="Tìm sản phẩm" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <div className="flex flex-wrap gap-2">
          {[{ id: null as number | null, name: 'Tất cả' }, ...(groups.data ?? [])].map(g => (
            <button key={g.id ?? 0} type="button" onClick={() => { setGroupId(g.id); setPage(1); }}
              className={clsx('rounded-full border px-3 py-1 text-sm', groupId === g.id ? 'border-teal-700 bg-teal-700 text-white' : 'border-stone-300 bg-white hover:border-stone-400')}>{g.name}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.data?.items.map(p => (
          <Link key={p.id} to="/shop/p/$id" params={{ id: String(p.id) }} className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 hover:ring-stone-300">
            <div className="aspect-square overflow-hidden">{p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover transition group-hover:scale-105" /> : <Placeholder />}</div>
            <div className="space-y-1 p-3">
              <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
              <div className="font-semibold text-teal-800">{priceText(p.price, p.maxPrice)}</div>
              {!p.inStock && <div className="text-xs text-stone-500">Hết hàng</div>}
            </div>
          </Link>
        ))}
      </div>
      {list.data && !list.data.items.length && <p className="py-12 text-center text-stone-500">Không tìm thấy sản phẩm phù hợp</p>}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: pages }, (_, i) => i + 1).map(n => <button key={n} type="button" onClick={() => setPage(n)} className={clsx('h-9 w-9 rounded-full text-sm', n === page ? 'bg-teal-700 text-white' : 'bg-white ring-1 ring-stone-200')}>{n}</button>)}
        </div>
      )}
    </div>
  );
}
