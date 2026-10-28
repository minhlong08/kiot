import { Plus, Trash2 } from 'lucide-react';
import { MoneyInput, NumberInput } from '../../components/Field';
import type { UnitDraft } from './formTypes';

export function UnitsEditor({ baseUnit, onBaseUnit, units, onChange, basePrice }: { baseUnit: string; onBaseUnit: (v: string) => void; units: UnitDraft[]; onChange: (u: UnitDraft[]) => void; basePrice: number }) {
  const set = (i: number, patch: Partial<UnitDraft>) => onChange(units.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Thêm đơn vị bán hoặc nhập như hộp, lốc, thùng. Tồn kho luôn tính theo đơn vị cơ bản.</p>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-36 shrink-0">Đơn vị cơ bản</span>
        <input className="input max-w-48" placeholder="VD: cái, chiếc, đôi" value={baseUnit} onChange={e => onBaseUnit(e.target.value)} aria-label="Đơn vị cơ bản" />
      </label>
      {units.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left">Tên đơn vị</th><th className="text-right">Quy đổi</th><th className="text-left">Mã hàng</th><th className="text-left">Mã vạch</th><th className="text-right">Giá bán</th><th>Bán trực tiếp</th><th /></tr></thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={i}>
                <td className="py-1 pr-1"><input className="input" value={u.name} onChange={e => set(i, { name: e.target.value })} aria-label={`Tên đơn vị ${i + 1}`} /></td>
                <td className="w-24 pr-1"><NumberInput value={u.conversion} onChange={v => set(i, { conversion: Math.max(2, Math.round(v)), price: u.price || basePrice * Math.max(2, Math.round(v)) })} /></td>
                <td className="pr-1"><input className="input" placeholder="Tự động" value={u.code} onChange={e => set(i, { code: e.target.value })} /></td>
                <td className="pr-1"><input className="input" value={u.barcode} onChange={e => set(i, { barcode: e.target.value })} /></td>
                <td className="w-32 pr-1"><MoneyInput value={u.price} onChange={v => set(i, { price: v })} /></td>
                <td className="text-center"><input type="checkbox" checked={u.isDirectSale} onChange={e => set(i, { isDirectSale: e.target.checked })} /></td>
                <td><button type="button" className="btn-ghost" aria-label="Xóa đơn vị" onClick={() => onChange(units.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn" onClick={() => onChange([...units, { name: '', conversion: 2, code: '', barcode: '', price: basePrice * 2, isDirectSale: true }])}><Plus size={14} />Thêm đơn vị</button>
    </div>
  );
}
