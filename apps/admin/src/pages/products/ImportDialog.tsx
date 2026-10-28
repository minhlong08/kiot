import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { api, download } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { toast, toastError } from '../../components/toast';

type Result = { created: number; updated: number; errors: { row: number; message: string }[] };

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'create' | 'upsert'>('create');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<Result>('/products/import', { body: fd, query: { mode } });
      setResult(r);
      if (!r.errors.length) {
        await qc.invalidateQueries({ queryKey: ['products'] });
        await qc.invalidateQueries({ queryKey: ['product-groups'] });
        toast(`Đã import: ${r.created} thêm mới, ${r.updated} cập nhật`);
      }
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }

  const close = () => { setFile(null); setResult(null); onClose(); };
  return (
    <Modal open={open} title="Nhập hàng hóa từ file dữ liệu" onClose={close}
      footer={<><button type="button" className="btn" onClick={close}>Đóng</button><button type="button" className="btn-primary" disabled={!file || busy} onClick={run}>{busy ? 'Đang xử lý...' : 'Thực hiện'}</button></>}>
      <div className="space-y-4 text-sm">
        <p>Tải về file mẫu, điền dữ liệu rồi chọn file để nhập. Nhóm hàng dạng <code>Nhóm cha&gt;Nhóm con</code> sẽ được tạo nếu chưa có.</p>
        <button type="button" className="btn" onClick={() => download('/products/import-template', undefined, 'mau-import-hang-hoa.xlsx')}><Download size={16} />Tải về file mẫu</button>
        <div className="space-y-1">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />Chỉ thêm mới (báo lỗi nếu trùng mã)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'upsert'} onChange={() => setMode('upsert')} />Thêm mới và cập nhật hàng đã có theo mã</label>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn" onClick={() => input.current?.click()}><Upload size={16} />Chọn file dữ liệu</button>
          <span className="text-slate-600">{file?.name ?? 'Chưa chọn file'}</span>
          <input ref={input} type="file" hidden accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </div>
        {result && result.errors.length > 0 && (
          <div className="rounded border border-rose-200 bg-rose-50 p-3">
            <div className="mb-2 font-medium text-rose-800">Có {result.errors.length} lỗi, chưa có dữ liệu nào được nhập:</div>
            <table className="w-full"><tbody>{result.errors.map(e => <tr key={e.row}><td className="w-20 align-top text-rose-700">Dòng {e.row}</td><td>{e.message}</td></tr>)}</tbody></table>
          </div>
        )}
        {result && !result.errors.length && <div className="rounded bg-emerald-50 p-3 text-emerald-800">Hoàn thành: {result.created} thêm mới, {result.updated} cập nhật.</div>}
      </div>
    </Modal>
  );
}
