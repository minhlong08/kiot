import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { addToCart, useCart } from './cart';
import { Placeholder } from './ShopHome';

type Detail = { id: number; name: string; price: number; description: string; unit: string; images: string[]; inStock: boolean; variants: { id: number; label: string; price: number; inStock: boolean; imageUrl: string | null }[] };

export function ShopProduct() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const [cart, setCart] = useCart();
  const p = useQuery({ queryKey: ['shop', 'product', id], queryFn: () => api<Detail>(`/shop/products/${id}`) });
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  if (p.isError) return <p className="py-12 text-center text-stone-500">Sản phẩm không còn bán. <Link to="/shop" className="text-teal-700 underline">Xem sản phẩm khác</Link></p>;
  if (!p.data) return null;
  const d = p.data;
  const variant = d.variants.find(v => v.id === variantId) ?? null;
  const needsVariant = d.variants.length > 0;
  const price = variant?.price ?? d.price;
  const inStock = needsVariant ? !!variant?.inStock : d.inStock;
  const image = variant?.imageUrl ?? d.images[0] ?? null;
  function add(go: boolean) {
    setCart(addToCart(cart, { productId: variant?.id ?? d.id, name: d.name, variant: variant?.label ?? '', price, imageUrl: image }, qty));
    if (go) navigate({ to: '/shop/cart' });
  }
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="space-y-2">
        <div className="aspect-square overflow-hidden rounded-xl bg-white ring-1 ring-stone-200">{image ? <img src={image} alt={d.name} className="h-full w-full object-cover" /> : <Placeholder />}</div>
        {d.images.length > 1 && <div className="flex gap-2">{d.images.map(u => <img key={u} src={u} alt="" className="h-16 w-16 rounded object-cover ring-1 ring-stone-200" />)}</div>}
      </div>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{d.name}</h1>
        <div className="text-2xl font-semibold text-teal-800">{formatVnd(price)} đ</div>
        {needsVariant && (
          <div>
            <div className="mb-2 text-sm text-stone-600">Chọn phân loại</div>
            <div className="flex flex-wrap gap-2">
              {d.variants.map(v => (
                <button key={v.id} type="button" disabled={!v.inStock} onClick={() => setVariantId(v.id)}
                  className={clsx('rounded-lg border px-3 py-1.5 text-sm', v.id === variantId ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-stone-300 bg-white', !v.inStock && 'cursor-not-allowed opacity-40 line-through')}>{v.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="text-sm text-stone-600">Số lượng</span>
          <input type="number" min={1} max={99} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5" aria-label="Số lượng" value={qty} onChange={e => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
        </div>
        <div className="flex gap-3">
          <button type="button" disabled={!inStock} onClick={() => add(false)} className="rounded-full border border-teal-700 px-5 py-2.5 font-medium text-teal-800 disabled:opacity-40">Thêm vào giỏ</button>
          <button type="button" disabled={!inStock} onClick={() => add(true)} className="rounded-full bg-teal-700 px-5 py-2.5 font-medium text-white disabled:opacity-40">Mua ngay</button>
        </div>
        {!inStock && <p className="text-sm text-stone-500">{needsVariant && !variant ? 'Vui lòng chọn phân loại' : 'Tạm hết hàng'}</p>}
        {d.description && <div className="whitespace-pre-line border-t border-stone-200 pt-4 text-sm leading-relaxed text-stone-700">{d.description}</div>}
      </div>
    </div>
  );
}
