import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { api, download } from '../../lib/api';
import { toastError } from '../../components/toast';

/** Empty-state helper: build receipt lines from an Excel file (code, qty, unit cost, discount). */
export function LinesImport({ onLines }: { onLines: (lines: Record<string, unknown>[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  async function load(file: File | undefined) {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ lines: Record<string, unknown>[]; errors: { row: number; message: string }[] }>('/purchase-receipts/lines-import', { body: fd });
      setErrors(r.errors);
      if (r.lines.length) onLines(r.lines);
    } catch (e) { toastError(e); } finally { if (input.current) input.current.value = ''; }
  }
  return (
    <div className="space-y-3 text-slate-600">
      <div className="font-semibold">Thêm sản phẩm từ file excel</div>
      <div className="text-sm">(Tải về file mẫu: <button type="button" className="text-brand-700 hover:underline" onClick={() => download('/purchase-receipts/lines-template', undefined, 'mau-nhap-hang.xlsx')}>Excel file</button>)</div>
      <button type="button" className="btn-primary" onClick={() => input.current?.click()}><FileSpreadsheet size={16} />Chọn file dữ liệu</button>
      <input ref={input} type="file" hidden accept=".xlsx" onChange={e => load(e.target.files?.[0])} />
      {errors.length > 0 && <div className="mx-auto max-w-md rounded bg-rose-50 p-2 text-left text-sm text-rose-800">{errors.map(e => <div key={e.row}>Dòng {e.row}: {e.message}</div>)}</div>}
    </div>
  );
}
