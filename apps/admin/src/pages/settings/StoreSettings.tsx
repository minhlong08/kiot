import { Field } from '../../components/Field';
import { useSettingsSection } from './useSettingsForm';

export function StoreSettings() {
  const { value, patch, save, saving } = useSettingsSection('store');
  if (!value) return null;
  const text = (k: keyof typeof value, label: string, textarea = false) => (
    <Field label={label}>
      {textarea
        ? <textarea className="input" rows={2} value={value[k]} onChange={e => patch({ [k]: e.target.value })} />
        : <input className="input" value={value[k]} onChange={e => patch({ [k]: e.target.value })} />}
    </Field>
  );
  return (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {text('name', 'Tên cửa hàng')}
      {text('phone', 'Điện thoại')}
      <div className="sm:col-span-2">{text('address', 'Địa chỉ')}</div>
      {text('taxCode', 'Mã số thuế')}
      {text('logoUrl', 'Logo (URL)')}
      <div className="sm:col-span-2">{text('notice', 'Thông báo hiển thị cuối trang', true)}</div>
      <div><button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button></div>
    </div>
  );
}
