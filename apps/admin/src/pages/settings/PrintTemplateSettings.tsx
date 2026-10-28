import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TEMPLATE_KIND_LABELS, TEMPLATE_PLACEHOLDERS, renderTemplate, templateSample, type TemplateKind } from '@pd/shared';
import { api } from '../../lib/api';
import { useSettings } from '../../lib/settings';
import { toast, toastError } from '../../components/toast';

type Tpl = { kind: TemplateKind; size: string; body: string; isDefault: boolean };

/** Print template editor: placeholder palette, HTML body, live preview with sample data. */
export function PrintTemplateSettings() {
  const qc = useQueryClient();
  const settings = useSettings();
  const list = useQuery({ queryKey: ['print-templates'], queryFn: () => api<Tpl[]>('/print-templates') });
  const [kind, setKind] = useState<TemplateKind>('invoice');
  const sizes = (list.data ?? []).filter(t => t.kind === kind).map(t => t.size);
  const [size, setSize] = useState('80');
  const current = list.data?.find(t => t.kind === kind && t.size === size) ?? list.data?.find(t => t.kind === kind);
  const [body, setBody] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (current) { setSize(current.size); setBody(current.body); } }, [current?.kind, current?.size, current?.body]);
  const store = settings.data?.store ?? { name: '', address: '', phone: '' };
  const preview = renderTemplate(body, templateSample(kind, store));
  function insert(token: string) {
    const text = token.replace('…', '');
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    setBody(b => b.slice(0, at) + text + b.slice(el?.selectionEnd ?? at));
  }
  async function save() {
    try { await api(`/print-templates/${kind}/${size}`, { method: 'PUT', body: { body } }); await qc.invalidateQueries({ queryKey: ['print-templates'] }); toast('Đã lưu mẫu in'); } catch (e) { toastError(e); }
  }
  async function reset() {
    try { await api(`/print-templates/${kind}/${size}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['print-templates'] }); toast('Đã khôi phục mẫu mặc định'); } catch (e) { toastError(e); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-56" aria-label="Loại mẫu in" value={kind} onChange={e => setKind(e.target.value as TemplateKind)}>{(Object.keys(TEMPLATE_KIND_LABELS) as TemplateKind[]).map(k => <option key={k} value={k}>{TEMPLATE_KIND_LABELS[k]}</option>)}</select>
        <select className="input w-32" aria-label="Khổ giấy" value={current?.size ?? size} onChange={e => setSize(e.target.value)}>{sizes.map(s => <option key={s} value={s}>{/^\d+$/.test(s) ? `K${s}` : s}</option>)}</select>
        {current && <span className="text-xs text-slate-500">{current.isDefault ? 'Đang dùng mẫu mặc định' : 'Mẫu đã chỉnh sửa'}</span>}
        <span className="ml-auto" />
        {current && !current.isDefault && <button type="button" className="btn" onClick={reset}>Khôi phục mặc định</button>}
        <button type="button" className="btn-primary" onClick={save}>Lưu mẫu</button>
      </div>
      <div className="flex flex-wrap gap-1">{TEMPLATE_PLACEHOLDERS[kind].map(([token, label]) => <button key={token} type="button" title={token} className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200" onClick={() => insert(token)}>{label}</button>)}</div>
      <div className="grid gap-3 xl:grid-cols-2">
        <textarea ref={area} aria-label="Nội dung mẫu in" className="input h-[520px] font-mono text-xs" spellCheck={false} value={body} onChange={e => setBody(e.target.value)} />
        <iframe title="Xem trước" className="h-[520px] w-full rounded-lg bg-white ring-1 ring-slate-200" srcDoc={preview} sandbox="" />
      </div>
      <p className="text-xs text-slate-500">Cú pháp: {'{{trường}}'} (tự thoát HTML), {'{{money tổng}}'}, {'{{date thời gian}}'}, {'{{words tổng}}'}, lặp {'{{#lines}}…{{/lines}}'}, điều kiện {'{{#trường}}…{{/trường}}'} / {'{{^trường}}…{{/trường}}'}.</p>
    </div>
  );
}
