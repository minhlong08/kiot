import { Trash2 } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { NumberInput } from '../../components/Field';
import { ProductPicker } from '../../components/docs/ProductPicker';
import type { ComboDraft } from './formTypes';

export function ComboEditor({ items, onChange, showCost }: { items: ComboDraft[]; onChange: (v: ComboDraft[]) => void; showCost: boolean }) {
  const totalPrice = items.reduce((s, i) => s + i.price * i.qty, 0);
  const totalCost = items.reduce((s, i) => s + i.cost * i.qty, 0);
  return (
    <div className="space-y-2">
      <ProductPicker placeholder="Thêm hàng thành phần" exclude={r => r.type === 'combo' || r.unitId !== null}
        onPick={r => {
          const found = items.find(i => i.itemId === r.productId);
          onChange(found ? items.map(i => (i.itemId === r.productId ? { ...i, qty: i.qty + 1 } : i)) : [...items, { itemId: r.productId, qty: 1, code: r.code, name: r.name, price: r.price, cost: r.cost ?? 0 }]);
        }} />
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-2 py-1 text-left">STT</th><th className="text-left">Mã hàng</th><th className="text-left">Tên hàng thành phần</th><th className="text-right">Số lượng</th>{showCost && <th className="text-right">Tổng giá vốn</th>}<th className="text-right">Tổng giá bán</th><th /></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.itemId} className="border-t border-slate-100">
              <td className="px-2 py-1">{i + 1}</td><td>{it.code}</td><td>{it.name}</td>
              <td className="w-24 py-1"><NumberInput value={it.qty} onChange={v => onChange(items.map(x => (x.itemId === it.itemId ? { ...x, qty: Math.max(1, Math.round(v)) } : x)))} /></td>
              {showCost && <td className="num">{formatVnd(it.cost * it.qty)}</td>}
              <td className="num">{formatVnd(it.price * it.qty)}</td>
              <td><button type="button" className="btn-ghost" aria-label="Xóa thành phần" onClick={() => onChange(items.filter(x => x.itemId !== it.itemId))}><Trash2 size={14} /></button></td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={7} className="py-4 text-center text-slate-400">Chưa có hàng thành phần</td></tr>}
        </tbody>
        {items.length > 0 && <tfoot><tr className="font-medium"><td colSpan={4} className="py-1 text-right">Tổng</td>{showCost && <td className="num">{formatVnd(totalCost)}</td>}<td className="num">{formatVnd(totalPrice)}</td><td /></tr></tfoot>}
      </table>
    </div>
  );
}
