import { useFunds } from '../../lib/cash';
import { Field } from '../../components/Field';
import { useSettingsSection } from './useSettingsForm';

const METHODS = [['cash', 'Tiền mặt', 'cash'], ['transfer', 'Chuyển khoản', 'bank'], ['card', 'Thẻ', 'bank'], ['ewallet', 'Ví điện tử', 'ewallet']] as const;

export function PosSettings() {
  const { value, patch, save, saving } = useSettingsSection('pos');
  const funds = useFunds();
  if (!value) return null;
  const banks = (funds.data ?? []).filter(f => f.type === 'bank');
  const qrFund = banks.find(f => f.bankBin === value.bankQr.bankBin && f.accountNumber === value.bankQr.accountNumber);
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="mb-2 font-medium">Quỹ mặc định theo phương thức thanh toán</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {METHODS.map(([key, label, type]) => (
            <Field key={key} label={label}>
              <select className="input" aria-label={`Quỹ ${label}`} value={value.defaultFundIds[key] ?? ''}
                onChange={e => patch({ defaultFundIds: { ...value.defaultFundIds, [key]: e.target.value ? Number(e.target.value) : null } })}>
                <option value="">Quỹ đầu tiên phù hợp</option>
                {(funds.data ?? []).filter(f => f.type === type).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </div>
      <Field label="Tài khoản VietQR" hint="Mã QR chuyển khoản in trên hóa đơn và hiển thị khi thanh toán. Tài khoản cần có mã BIN ngân hàng (Thiết lập › Sổ quỹ).">
        <select className="input" aria-label="Tài khoản VietQR" value={qrFund?.id ?? ''}
          onChange={e => {
            const f = banks.find(x => x.id === Number(e.target.value));
            patch({ bankQr: { bankBin: f?.bankBin ?? '', accountNumber: f?.accountNumber ?? '', accountName: f?.accountName ?? '' } });
          }}>
          <option value="">Không dùng VietQR</option>
          {banks.map(f => <option key={f.id} value={f.id} disabled={!f.bankBin || !f.accountNumber}>{f.name}{f.accountNumber ? ` · ${f.accountNumber}` : ''}{!f.bankBin ? ' (thiếu mã BIN)' : ''}</option>)}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Khổ in hóa đơn">
          <select className="input" value={value.receiptTemplate} onChange={e => patch({ receiptTemplate: e.target.value as typeof value.receiptTemplate })}>
            <option value="58">K58 (58mm)</option><option value="80">K80 (80mm)</option><option value="A4">A4</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.printAfterPayment} onChange={e => patch({ printAfterPayment: e.target.checked })} />In hóa đơn sau khi thanh toán</label>
      <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
    </div>
  );
}
