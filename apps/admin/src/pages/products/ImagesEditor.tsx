import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { toastError } from '../../components/toast';

export function ImagesEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 10 - value.length)) {
        const fd = new FormData();
        fd.append('file', f);
        urls.push((await api<{ url: string }>('/uploads', { body: fd })).url);
      }
      onChange([...value, ...urls]);
    } catch (e) { toastError(e); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <div className="grid grid-cols-4 gap-2">
      {value.map((url, i) => (
        <div key={url} className={`group relative overflow-hidden rounded-lg bg-slate-100 ${i === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'}`}>
          <img src={url} alt="" className="h-full w-full object-cover" />
          <button type="button" aria-label="Xóa ảnh" onClick={() => onChange(value.filter(u => u !== url))} className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 opacity-0 group-hover:opacity-100"><X size={14} /></button>
        </div>
      ))}
      {value.length < 10 && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-500 ${value.length ? 'aspect-square' : 'col-span-4 h-36'}`}>
          <ImagePlus size={20} />{busy ? 'Đang tải...' : 'Thêm ảnh'}
          {!value.length && <span>Mỗi ảnh không quá 2 MB</span>}
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden onChange={e => upload(e.target.files)} />
    </div>
  );
}
