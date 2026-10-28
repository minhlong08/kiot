import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { PROVINCES, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { cartTotal, setQty, useCart } from './cart';
import { Placeholder } from './ShopHome';

const input = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2';

/** Cart review and the order form; a successful order empties the cart and shows its code. */
export function ShopCheckout() {
  const [cart, setCart] = useCart();
  const [f, setF] = useState({ name: '', phone: '', address: '', province: '', ward: '', note: '' });
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ code: string }>('/shop/orders', { body: { customer: f, lines: cart.map(l => ({ productId: l.productId, qty: l.qty })), website: trap } });
      setCart([]);
      setDone(r.code);
    } catch (err) { setError(err instanceof Error ? err.message : 'Không gửi được đơn hàng'); } finally { setBusy(false); }
  }
  if (done) return (
    <div className="mx-auto max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-stone-200">
      <h1 className="mb-2 text-xl font-semibold">Đặt hàng thành công</h1>
      <p className="text-stone-600">Mã đơn của bạn là <b className="text-teal-800">{done}</b>. Cửa hàng sẽ gọi điện xác nhận trong thời gian sớm nhất.</p>
      <a href="/shop" className="mt-6 inline-block rounded-full bg-teal-700 px-5 py-2.5 font-medium text-white">Tiếp tục mua sắm</a>
    </div>
  );
  if (!cart.length) return <p className="py-12 text-center text-stone-500">Giỏ hàng trống. <a href="/shop" className="text-teal-700 underline">Xem sản phẩm</a></p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Giỏ hàng</h1>
        {cart.map(l => (
          <div key={l.productId} className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">{l.imageUrl ? <img src={l.imageUrl} alt="" className="h-full w-full object-cover" /> : <Placeholder />}</div>
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.name}</div>{l.variant && <div className="text-sm text-stone-500">{l.variant}</div>}<div className="text-sm text-teal-800">{formatVnd(l.price)} đ</div></div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Giảm" className="rounded-full p-1 ring-1 ring-stone-300" onClick={() => setCart(setQty(cart, l.productId, l.qty - 1))}><Minus size={14} /></button>
              <span className="w-8 text-center tabular-nums">{l.qty}</span>
              <button type="button" aria-label="Tăng" className="rounded-full p-1 ring-1 ring-stone-300" onClick={() => setCart(setQty(cart, l.productId, l.qty + 1))}><Plus size={14} /></button>
            </div>
            <button type="button" aria-label="Xóa" className="p-1 text-stone-400 hover:text-rose-600" onClick={() => setCart(setQty(cart, l.productId, 0))}><Trash2 size={16} /></button>
          </div>
        ))}
      </section>
      <form onSubmit={submit} className="space-y-3 rounded-xl bg-white p-5 ring-1 ring-stone-200">
        <h2 className="font-semibold">Thông tin nhận hàng</h2>
        <label className="block text-sm">Họ tên<input required className={input} aria-label="Họ tên" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="block text-sm">Số điện thoại<input required inputMode="tel" className={input} aria-label="Số điện thoại" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        <label className="block text-sm">Tỉnh/Thành phố<select className={input} aria-label="Tỉnh/Thành phố" value={f.province} onChange={e => setF({ ...f, province: e.target.value })}><option value="">Chọn tỉnh/thành</option>{PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="block text-sm">Địa chỉ<input required className={input} aria-label="Địa chỉ" placeholder="Số nhà, đường, phường/xã" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></label>
        <label className="block text-sm">Ghi chú<textarea className={input} rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
        <label aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">Website<input tabIndex={-1} autoComplete="off" value={trap} onChange={e => setTrap(e.target.value)} /></label>
        <div className="flex items-center justify-between border-t border-stone-200 pt-3"><span>Tạm tính</span><b data-testid="checkout-total" className="text-lg text-teal-800 tabular-nums">{formatVnd(cartTotal(cart))} đ</b></div>
        <p className="text-xs text-stone-500">Phí giao hàng sẽ được cửa hàng báo khi xác nhận đơn. Thanh toán khi nhận hàng.</p>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-teal-700 py-2.5 font-medium text-white disabled:opacity-50">Đặt hàng</button>
      </form>
    </div>
  );
}
