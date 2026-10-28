import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api, download } from '../lib/api';
import { Modal } from './Modal';
import { toast, toastError } from './toast';

type Result = { created?: number; updated?: number; errors: { row: number; message: string }[] };

/** Generic "download template → choose xlsx → show row errors" dialog. */
export function ImportFileDialog({ open, onClose, title, templatePath, templateName, importPath, onDone }: { open: boolean; onClose: () => void; title: string; templatePath: string; templateName: string; importPath: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<Result>(importPath, { body: fd });
      setResult(r);
      if (!r.errors.length) { toast(`Đã nhập ${r.created ?? 0} dòng`); onDone(); }
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }
  const close = () => { setFile(null); setResult(null); onClose(); };
  return (
    <Modal open={open} title={title} onClose={close}
      footer={<><button type="button" className="btn" onClick={close}>Đóng</button><button type="button" className="btn-primary" disabled={!file || busy} onClick={run}>Thực hiện</button></>}>
      <div className="space-y-3 text-sm">
        <button type="button" className="btn" onClick={() => download(templatePath, undefined, templateName)}><Download size={16} />Tải về file mẫu</button>
        <div className="flex items-center gap-3">
          <button type="button" className="btn" onClick={() => input.current?.click()}><Upload size={16} />Chọn file dữ liệu</button>
          <span>{file?.name ?? 'Chưa chọn file'}</span>
          <input ref={input} type="file" hidden accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </div>
        {result && result.errors.length > 0 && (
          <div className="rounded border border-rose-200 bg-rose-50 p-3">
            <div className="mb-1 font-medium text-rose-800">Có {result.errors.length} lỗi, chưa có dữ liệu nào được nhập:</div>
            {result.errors.map(e => <div key={e.row}>Dòng {e.row}: {e.message}</div>)}
          </div>
        )}
        {result && !result.errors.length && <div className="rounded bg-emerald-50 p-3 text-emerald-800">Hoàn thành: {result.created ?? 0} dòng.</div>}
      </div>
    </Modal>
  );
}
