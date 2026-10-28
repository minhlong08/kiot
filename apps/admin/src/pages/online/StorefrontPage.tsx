import { ExternalLink } from 'lucide-react';
import { Field } from '../../components/Field';
import { useBranches } from '../products/useLookups';
import { useSettingsSection } from '../settings/useSettingsForm';

/** Website settings; products appear on the site when "Bán trực tuyến" is ticked on the product. */
export function StorefrontPage() {
  const { value, patch, save, saving } = useSettingsSection('online');
  const branches = useBranches();
  if (!value) return null;
  return (
    <div className="max-w-2xl space-y-4 p-4">
      <div className="flex items-center"><h1 className="mr-auto text-xl font-bold">Website bán hàng</h1><a href="/shop" target="_blank" rel="noreferrer" className="btn"><ExternalLink size={16} />Mở website</a></div>
      <div className="card space-y-4 p-5">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={value.enabled} onChange={e => patch({ enabled: e.target.checked })} />Bật website bán hàng</label>
        <Field label="Chi nhánh nhận đơn và hiển thị tồn kho">
          <select className="input" value={value.branchId ?? ''} onChange={e => patch({ branchId: e.target.value ? Number(e.target.value) : null })}><option value="">Chi nhánh đầu tiên</option>{branches.data?.items.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Field>
        <Field label="Hotline hiển thị"><input className="input" value={value.hotline} onChange={e => patch({ hotline: e.target.value })} /></Field>
        <Field label="Lời giới thiệu"><textarea className="input" rows={3} value={value.intro} onChange={e => patch({ intro: e.target.value })} /></Field>
        <p className="text-sm text-slate-500">Sản phẩm hiển thị trên website khi được đánh dấu "Bán trực tuyến" trong màn hình Hàng hóa. Đơn đặt từ website vào mục Đơn hàng online với trạng thái Chờ xác nhận.</p>
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>Lưu</button>
      </div>
    </div>
  );
}
