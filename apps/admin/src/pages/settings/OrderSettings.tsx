import { Field } from '../../components/Field';
import { useSettingsSection } from './useSettingsForm';

const PREFIX_LABELS: Record<string, string> = {
  invoice: 'Hóa đơn', return: 'Trả hàng', customerOrder: 'Đặt hàng', purchaseReceipt: 'Nhập hàng', purchaseReturn: 'Trả hàng nhập',
  purchaseOrder: 'Đặt hàng nhập', stockTake: 'Kiểm kho', writeOff: 'Xuất hủy', internalUse: 'Xuất dùng nội bộ', transfer: 'Chuyển hàng',
  cashIn: 'Phiếu thu', cashOut: 'Phiếu chi', product: 'Hàng hóa', customer: 'Khách hàng', supplier: 'Nhà cung cấp',
};

export function OrderSettings() {
  const { value, patch, save, saving } = useSettingsSection('orders');
  if (!value) return null;
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h3 className="mb-2 font-semibold">Tiền tố mã chứng từ</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(value.codePrefixes).map(([k, v]) => (
            <Field key={k} label={PREFIX_LABELS[k] ?? k}>
              <input className="input uppercase" maxLength={6} value={v} onChange={e => patch({ codePrefixes: { ...value.codePrefixes, [k]: e.target.value.toUpperCase() } })} />
            </Field>
          ))}
        </div>
      </div>
      <Field label="Làm tròn tổng tiền hóa đơn" className="max-w-xs">
        <select className="input" value={value.rounding} onChange={e => patch({ rounding: e.target.value as typeof value.rounding })}>
          <option value="none">Không làm tròn</option>
          <option value="hundred">Làm tròn đến hàng trăm</option>
          <option value="thousand">Làm tròn đến hàng nghìn</option>
        </select>
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value.requireCustomer} onChange={e => patch({ requireCustomer: e.target.checked })} />
        Bắt buộc chọn khách hàng khi bán hàng
      </label>
      <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
    </div>
  );
}
