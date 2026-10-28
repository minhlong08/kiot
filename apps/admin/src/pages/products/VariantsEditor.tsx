import { Plus, Trash2 } from 'lucide-react';
import { variantCombos } from '@pd/shared';
import { MoneyInput, NumberInput } from '../../components/Field';
import { splitValues, type AttrDraft, type VariantDraft } from './formTypes';

/** Rebuilds the variant rows for the current attributes, keeping data of rows whose values still exist. */
export function syncVariants(attributes: AttrDraft[], current: VariantDraft[], defaults: { price: number; cost: number }): VariantDraft[] {
  const combos = variantCombos(attributes.map(a => ({ name: a.name, values: splitValues(a.valuesText) })).filter(a => a.name.trim()));
  return combos.map(values => current.find(v => v.values.join('|') === values.join('|')) ?? { values, code: '', barcode: '', price: defaults.price, cost: defaults.cost, onHand: 0 });
}

type Props = {
  attributes: AttrDraft[]; variants: VariantDraft[]; isEdit: boolean; showCost: boolean;
  onChange: (attributes: AttrDraft[], variants: VariantDraft[]) => void; defaults: { price: number; cost: number };
};

export function VariantsEditor({ attributes, variants, isEdit, showCost, onChange, defaults }: Props) {
  const setAttrs = (next: AttrDraft[]) => onChange(next, syncVariants(next, variants, defaults));
  const setVariant = (i: number, patch: Partial<VariantDraft>) => onChange(attributes, variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Thêm đặc điểm như màu sắc, kích cỡ. Mỗi tổ hợp giá trị sẽ là một hàng cùng loại có mã và tồn kho riêng. Nhập các giá trị cách nhau bởi dấu phẩy.</p>
      {attributes.map((a, i) => (
        <div key={i} className="flex gap-2">
          <input className="input w-40" placeholder="VD: Màu sắc" aria-label={`Tên thuộc tính ${i + 1}`} value={a.name} onChange={e => setAttrs(attributes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input flex-1" placeholder="VD: Đen, Xám, Xanh" aria-label={`Giá trị thuộc tính ${i + 1}`} value={a.valuesText} onChange={e => setAttrs(attributes.map((x, j) => (j === i ? { ...x, valuesText: e.target.value } : x)))} />
          <button type="button" className="btn-ghost" aria-label="Xóa thuộc tính" onClick={() => setAttrs(attributes.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      {attributes.length < 3 && <button type="button" className="btn" onClick={() => setAttrs([...attributes, { name: '', valuesText: '' }])}><Plus size={14} />Thêm thuộc tính</button>}
      {variants.length > 0 && (
        <div className="overflow-x-auto">
          <div className="mb-1 text-sm font-medium">Hàng cùng loại ({variants.length})</div>
          <table data-testid="variants-table" className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="px-2 py-1 text-left">Giá trị thuộc tính</th><th className="text-left">Mã hàng</th><th className="text-left">Mã vạch</th>{showCost && <th className="text-right">Giá vốn</th>}<th className="text-right">Giá bán</th>{!isEdit && <th className="text-right">Tồn kho</th>}</tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.values.join('|')}>
                  <td className="px-2 py-1 font-medium">{v.values.join(' - ')}</td>
                  <td className="pr-1"><input className="input" placeholder="Tự động" value={v.code} onChange={e => setVariant(i, { code: e.target.value })} /></td>
                  <td className="pr-1"><input className="input" value={v.barcode} onChange={e => setVariant(i, { barcode: e.target.value })} /></td>
                  {showCost && <td className="w-32 pr-1"><MoneyInput value={v.cost} onChange={x => setVariant(i, { cost: x })} /></td>}
                  <td className="w-32 pr-1"><MoneyInput value={v.price} onChange={x => setVariant(i, { price: x })} /></td>
                  {!isEdit && <td className="w-24"><NumberInput value={v.onHand} disabled={!!v.id} onChange={x => setVariant(i, { onHand: Math.max(0, Math.round(x)) })} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
