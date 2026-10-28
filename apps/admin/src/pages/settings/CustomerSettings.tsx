import { Field, MoneyInput } from '../../components/Field';
import { useSettingsSection } from './useSettingsForm';

export function CustomerSettings() {
  const { value, patch, save, saving } = useSettingsSection('customers');
  if (!value) return null;
  return (
    <div className="max-w-2xl space-y-4">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={value.loyaltyEnabled} onChange={e => patch({ loyaltyEnabled: e.target.checked })} />
        Bật tích điểm khách hàng
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Số tiền để được 1 điểm (VND)"><MoneyInput value={value.vndPerPoint} onChange={v => patch({ vndPerPoint: Math.max(1, v) })} /></Field>
        <Field label="Giá trị 1 điểm khi thanh toán (VND)"><MoneyInput value={value.pointValueVnd} onChange={v => patch({ pointValueVnd: v })} /></Field>
        <Field label="Hạn mức công nợ mặc định (0 = không giới hạn)"><MoneyInput value={value.debtLimit} onChange={v => patch({ debtLimit: v })} /></Field>
      </div>
      <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
    </div>
  );
}
