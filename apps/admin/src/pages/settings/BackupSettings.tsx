import { useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { api, download } from '../../lib/api';
import { ConfirmModal } from '../../components/Modal';
import { toast, toastError } from '../../components/toast';

/** Admin-only: full JSON backup, restore from a file, reset to demo data. */
export function BackupSettings() {
  const [pending, setPending] = useState<{ name: string; doc: unknown } | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    try { setPending({ name: file.name, doc: JSON.parse(await file.text()) }); } catch { toastError(new Error('File không phải bản sao lưu hợp lệ')); }
  }
  async function restore() {
    if (!pending) return;
    setBusy(true);
    try { await api('/system/restore', { body: pending.doc }); toast('Đã khôi phục dữ liệu'); setTimeout(() => window.location.reload(), 800); } catch (e) { toastError(e); } finally { setBusy(false); setPending(null); }
  }
  async function reset() {
    setBusy(true);
    try { await api('/system/reset-demo', { body: { confirm: phrase } }); toast('Đã tạo lại dữ liệu mẫu, vui lòng đăng nhập lại'); setTimeout(() => window.location.assign('/login'), 800); } catch (e) { toastError(e); } finally { setBusy(false); }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-2">
        <h3 className="font-medium">Sao lưu</h3>
        <p className="text-sm text-slate-500">Tải toàn bộ dữ liệu (hàng hóa, chứng từ, khách hàng, sổ quỹ, thiết lập…) về một file JSON. Ảnh đã tải lên nằm trong thư mục data/uploads và cần sao lưu riêng.</p>
        <button type="button" className="btn" onClick={() => download('/system/backup', undefined, `phuongdong-backup-${stamp}.json`).catch(toastError)}><Download size={16} />Tải bản sao lưu</button>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">Khôi phục</h3>
        <p className="text-sm text-slate-500">Thay toàn bộ dữ liệu hiện tại bằng dữ liệu trong file sao lưu. Mọi người dùng khác sẽ phải đăng nhập lại.</p>
        <label className="btn w-fit cursor-pointer"><Upload size={16} />Chọn file sao lưu<input type="file" accept="application/json,.json" aria-label="Chọn file sao lưu" className="sr-only" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </section>
      <section className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-4">
        <h3 className="font-medium text-rose-800">Xóa dữ liệu và tạo lại dữ liệu mẫu</h3>
        <p className="text-sm text-rose-700">Xóa toàn bộ dữ liệu, tạo lại cửa hàng mẫu. Tài khoản admin trở về mật khẩu admin123. Không thể hoàn tác — hãy tải bản sao lưu trước.</p>
        <div className="flex flex-wrap gap-2">
          <input className="input w-56" aria-label="Gõ XOA DU LIEU để xác nhận" placeholder="XOA DU LIEU" value={phrase} onChange={e => setPhrase(e.target.value)} />
          <button type="button" className="btn text-rose-700" disabled={phrase !== 'XOA DU LIEU' || busy} onClick={reset}><RotateCcw size={16} />Xóa và tạo lại dữ liệu mẫu</button>
        </div>
      </section>
      <ConfirmModal open={!!pending} danger title="Khôi phục dữ liệu" confirmLabel="Khôi phục" onClose={() => setPending(null)} onConfirm={restore}
        message={`Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu trong "${pending?.name ?? ''}". Tiếp tục?`} />
    </div>
  );
}
