import { useSettingsSection } from './useSettingsForm';

export function ProductSettings() {
  const { value, patch, save, saving } = useSettingsSection('products');
  if (!value) return null;
  return (
    <div className="max-w-2xl space-y-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={value.allowNegativeStock} onChange={e => patch({ allowNegativeStock: e.target.checked })} />
        <span><span className="font-medium">Cho phép bán khi hết tồn kho</span><span className="block text-sm text-slate-500">Hóa đơn vẫn được tạo khi số lượng tồn không đủ; tồn kho có thể âm.</span></span>
      </label>
      <div className="text-sm"><span className="font-medium">Phương pháp tính giá vốn:</span> Bình quân gia quyền theo từng chi nhánh</div>
      <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
    </div>
  );
}
