import { useState } from 'react';
import { api } from '../../lib/api';
import { toast, toastError } from '../../components/toast';
import { useGroups } from '../products/useLookups';
import { Field, NumberInput } from '../../components/Field';
import { useSettingsSection } from '../settings/useSettingsForm';

/** Sets one VAT rate on every product of a group (and its sub-groups). */
function VatByGroup() {
  const groups = useGroups();
  const [groupId, setGroupId] = useState(0);
  const [rate, setRate] = useState('');
  async function apply() {
    try {
      const r = await api<{ updated: number }>('/products/vat-by-group', { body: { groupId, vatRate: rate === '' ? null : Number(rate) } });
      toast(`Đã cập nhật thuế suất cho ${r.updated} hàng hóa`);
    } catch (e) { toastError(e); }
  }
  return (
    <div className="card space-y-3 p-5">
      <h2 className="font-semibold">Áp thuế suất cho nhóm hàng</h2>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nhóm hàng"><select className="input w-56" aria-label="Nhóm hàng" value={groupId} onChange={e => setGroupId(Number(e.target.value))}><option value={0}>Chọn nhóm</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Thuế suất (%)" hint="Để trống: dùng mức mặc định"><input className="input w-32" inputMode="numeric" aria-label="Thuế suất nhóm" value={rate} onChange={e => setRate(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
        <button type="button" className="btn" disabled={!groupId} onClick={apply}>Áp dụng</button>
      </div>
    </div>
  );
}

export function TaxSettingsPage() {
  const { value, patch, save, saving } = useSettingsSection('tax');
  if (!value) return null;
  return (
    <div className="max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Thiết lập thuế</h1>
      <div className="card space-y-4 p-5">
        <Field label="Loại hình kinh doanh">
          <select className="input" value={value.mode} onChange={e => patch({ mode: e.target.value as typeof value.mode })}>
            <option value="household">Hộ kinh doanh (thuế khoán theo % doanh thu)</option><option value="company">Doanh nghiệp (khấu trừ thuế GTGT)</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Thuế suất GTGT mặc định (%)" hint="Dùng khi hàng hóa không đặt thuế suất riêng"><NumberInput value={value.defaultVatRate} onChange={v => patch({ defaultVatRate: Math.min(100, v) })} /></Field>
          {value.mode === 'household' && <>
            <Field label="Tỷ lệ GTGT trên doanh thu (%)"><input type="number" step="0.1" min={0} className="input" value={value.householdVatRate} onChange={e => patch({ householdVatRate: Number(e.target.value) })} /></Field>
            <Field label="Tỷ lệ TNCN trên doanh thu (%)"><input type="number" step="0.1" min={0} className="input" value={value.householdPitRate} onChange={e => patch({ householdPitRate: Number(e.target.value) })} /></Field>
          </>}
        </div>
        <Field label="Ký hiệu hóa đơn điện tử"><input className="input max-w-40 uppercase" value={value.einvoiceSeries} onChange={e => patch({ einvoiceSeries: e.target.value.toUpperCase() })} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.autoIssue} onChange={e => patch({ autoIssue: e.target.checked })} />Tự động phát hành hóa đơn điện tử khi bán hàng hoàn thành</label>
        <p className="text-sm text-slate-500">Giá bán đã gồm thuế GTGT. Thuế suất riêng cho từng hàng hóa đặt trong màn hình Hàng hóa. Kết nối nhà cung cấp hóa đơn điện tử thật được cắm vào qua adapter (xem README).</p>
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
      </div>
      <VatByGroup />
    </div>
  );
}
