import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatVnd, parseVnd, type SaleResult } from '@pd/shared';
import type { Cart, CartLine } from '../state/carts';

type Props = {
  cart: Cart; preview: SaleResult; canEditPrice: boolean; promoNames: (line: CartLine) => string[];
  onQty: (key: string, qty: number) => void; onPatch: (key: string, patch: Partial<CartLine>) => void;
};

export function CartLines({ cart, preview, canEditPrice, promoNames, onQty, onPatch }: Props) {
  if (!cart.lines.length) return <div className="flex flex-1 items-center justify-center p-10 text-slate-400">Chưa có hàng hóa. Quét mã vạch hoặc tìm hàng hóa (F3).</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {cart.lines.map((l, i) => {
        const r = preview.lines.find(x => x.key === l.key);
        const names = promoNames(l);
        return (
          <div key={l.key} data-testid={`line-${l.code}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_6rem_6rem_1.5rem] items-center gap-1.5 border-b border-slate-100 px-2 py-2 xl:grid-cols-[2rem_minmax(0,1fr)_7.5rem_7rem_7rem_2rem] xl:gap-2 xl:px-3">
            <span className="text-slate-400">{i + 1}</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{l.name}</div>
              <div className="text-xs text-slate-500">{l.code} · {l.unitName}{names.length ? <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800">{names.join(', ')}</span> : null}</div>
              <input className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs text-slate-500 outline-none placeholder:text-slate-300" placeholder="Ghi chú" value={l.note} onChange={e => onPatch(l.key, { note: e.target.value })} />
            </div>
            <div className="flex items-center rounded border border-slate-300">
              <button type="button" className="px-1.5 py-1" aria-label={`Giảm ${l.code}`} onClick={() => onQty(l.key, l.qty - 1)}><Minus size={14} /></button>
              <input className="w-full min-w-0 border-0 p-1 text-center tabular-nums outline-none" aria-label={`Số lượng ${l.code}`} inputMode="numeric" value={String(l.qty)}
                onFocus={e => e.target.select()} onChange={e => onQty(l.key, Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)))} />
              <button type="button" className="px-1.5 py-1" aria-label={`Tăng ${l.code}`} onClick={() => onQty(l.key, l.qty + 1)}><Plus size={14} /></button>
            </div>
            <div className="text-right">
              {canEditPrice
                ? <input className="input py-1 text-right" aria-label={`Đơn giá ${l.code}`} value={formatVnd(l.price)} onFocus={e => e.target.select()} onChange={e => onPatch(l.key, { price: parseVnd(e.target.value) })} />
                : <span className="tabular-nums">{formatVnd(l.price)}</span>}
              <input className="mt-0.5 w-full border-0 bg-transparent p-0 text-right text-xs text-rose-600 outline-none" aria-label={`Giảm giá ${l.code}`} placeholder="Giảm giá"
                value={l.discount ? `-${formatVnd(l.discount)}` : ''} onChange={e => onPatch(l.key, { discount: Math.min(parseVnd(e.target.value), l.qty * l.price) })} />
            </div>
            <div className="num font-semibold">{formatVnd(r?.amount ?? l.qty * l.price)}{r?.promoDiscount ? <div className="text-xs font-normal text-amber-700">-{formatVnd(r.promoDiscount)}</div> : null}</div>
            <button type="button" className="text-slate-400 hover:text-rose-600" aria-label={`Xóa ${l.code}`} onClick={() => onQty(l.key, 0)}><Trash2 size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
