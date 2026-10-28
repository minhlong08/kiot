import type { ReactNode } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, Phone } from 'lucide-react';
import { api } from '../../lib/api';
import { cartCount, useCart } from './cart';

export type ShopInfo = { name: string; address: string; hotline: string; logoUrl: string; intro: string };
export const useShopInfo = () => useQuery({ queryKey: ['shop', 'info'], queryFn: () => api<ShopInfo>('/shop/info'), staleTime: 5 * 60_000 });

export function ShopFrame({ children }: { children: ReactNode }) {
  const info = useShopInfo();
  const [cart] = useCart();
  const n = cartCount(cart);
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/shop" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-stone-900">
            {info.data?.logoUrl ? <img src={info.data.logoUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded bg-teal-700 text-sm font-bold text-white">{(info.data?.name ?? 'S').slice(0, 1)}</span>}
            {info.data?.name ?? ''}
          </Link>
          {info.data?.hotline && <a href={`tel:${info.data.hotline}`} className="ml-auto hidden items-center gap-1 text-sm text-stone-600 sm:flex"><Phone size={14} />{info.data.hotline}</a>}
          <Link to="/shop/cart" className="relative ml-auto rounded-full p-2 hover:bg-stone-100 sm:ml-0" aria-label="Giỏ hàng">
            <ShoppingBag size={22} />
            {n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-teal-700 px-1 text-xs font-semibold text-white">{n}</span>}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="border-t border-stone-200 py-6 text-center text-sm text-stone-500">{info.data?.name}{info.data?.address ? ` · ${info.data.address}` : ''}</footer>
    </div>
  );
}

export function ShopLayout() {
  return <ShopFrame><Outlet /></ShopFrame>;
}
