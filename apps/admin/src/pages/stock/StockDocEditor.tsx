import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Field } from '../../components/Field';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { DocumentLinesEditor, type DocLine } from '../../components/docs/DocumentLinesEditor';
import { useBranches } from '../products/useLookups';
import { STOCK_DOCS, type StockDocKind } from './configs';

type Detail = { id: number; code: string; status: string; note: string; reason?: string; toBranchId?: number; createdAt: string; lines: Record<string, unknown>[] };

export function makeStockDocEditor(kind: StockDocKind) {
  return function StockDocEditor() {
    const cfg = STOCK_DOCS[kind];
    const params = useParams({ strict: false }) as { id?: string };
    const id = params.id && params.id !== 'new' ? Number(params.id) : undefined;
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { me, branch } = useAuth();
    const branches = useBranches();
    const [doc, setDoc] = useState<Detail | null>(null);
    const [lines, setLines] = useState<DocLine[]>([]);
    const [form, setForm] = useState({ code: '', note: '', reason: '', toBranchId: 0, zeroMissing: false });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (!id) return;
      api<Detail>(`${cfg.api}/${id}`).then(async d => {
        setDoc(d);
        setForm(f => ({ ...f, code: d.code, note: d.note, reason: d.reason ?? '', toBranchId: d.toBranchId ?? 0 }));
        setLines(d.lines.map(l => ({ ...l, productId: Number(l.productId), code: String(l.productCode), name: String(l.productName), unit: String(l.unit ?? ''), onHand: l.systemQty ?? 0, qtyReceived: d.status === 'inTransit' ? l.qtySent : l.qtyReceived })));
      }, toastError);
    }, [id, cfg.api]);

    const mode: 'edit' | 'view' | 'receive' = !doc || doc.status === 'draft' ? 'edit' : kind === 'transfer' && doc.status === 'inTransit' ? 'receive' : 'view';
    const receivingHere = mode === 'receive' && doc?.toBranchId === me?.user.branchId;
    const totalQty = lines.reduce((s, l) => s + Number(l[cfg.qtyKey] ?? 0), 0);

    async function submit(complete: boolean) {
      setBusy(true);
      try {
        if (mode === 'receive') {
          await api(`${cfg.api}/${id}/receive`, { body: { lines: lines.map(l => ({ productId: l.productId, qtyReceived: Number(l.qtyReceived ?? 0) })) } });
        } else {
          const body = {
            code: id ? undefined : form.code || undefined, note: form.note, reason: form.reason || undefined, kind: cfg.issueKind,
            toBranchId: kind === 'transfer' ? form.toBranchId : undefined, zeroMissing: form.zeroMissing,
            lines: lines.map(l => ({ productId: l.productId, [cfg.qtyKey]: Number(l[cfg.qtyKey] ?? 0) })),
            [cfg.completeFlag]: complete,
          };
          await api(id ? `${cfg.api}/${id}` : cfg.api, { method: id ? 'PUT' : 'POST', body });
        }
        await qc.invalidateQueries({ queryKey: [cfg.api] });
        await qc.invalidateQueries({ queryKey: ['products'] });
        toast('Đã lưu phiếu');
        navigate({ to: cfg.route });
      } catch (e) { toastError(e); } finally { setBusy(false); }
    }

    return (
      <div className="flex h-full flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
            <button type="button" className="btn-ghost" onClick={() => navigate({ to: cfg.route })} aria-label="Quay lại"><ArrowLeft size={18} /></button>
            <h1 className="text-lg font-semibold">{cfg.title}</h1>
            {doc && <DocStatusBadge status={doc.status} />}
          </div>
          <DocumentLinesEditor lines={lines} onChange={setLines} qtyKey={cfg.qtyKey} columns={cfg.lineColumns(mode)} readOnly={mode === 'view'}
            newLine={r => ({ onHand: r.onHand ?? 0, [cfg.qtyKey]: kind === 'stockTake' ? r.onHand ?? 0 : 1 })} />
        </div>
        <aside className="w-full space-y-3 border-l border-slate-200 bg-slate-50 p-4 lg:w-80">
          <div className="flex justify-between text-sm text-slate-600"><span>{me?.user.fullName}</span><span>{doc ? formatDateTime(doc.createdAt) : formatDateTime(new Date())}</span></div>
          <Field label="Mã phiếu"><input className="input" placeholder="Mã phiếu tự động" disabled={!!id} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></Field>
          {kind === 'transfer' && (
            <>
              <div className="text-sm"><span className="text-slate-500">Từ chi nhánh: </span>{branch?.name}</div>
              <Field label="Tới chi nhánh">
                <select className="input" value={form.toBranchId} disabled={mode !== 'edit'} onChange={e => setForm({ ...form, toBranchId: Number(e.target.value) })}>
                  <option value={0}>Chọn chi nhánh</option>
                  {branches.data?.items.filter(b => b.isActive && b.id !== me?.user.branchId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </>
          )}
          {cfg.issueKind && <Field label={kind === 'writeOff' ? 'Lý do hủy' : 'Mục đích sử dụng'}><input className="input" disabled={mode !== 'edit'} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>}
          <div className="flex justify-between text-sm"><span>Tổng số lượng</span><b>{formatVnd(totalQty)}</b></div>
          {kind === 'stockTake' && mode === 'edit' && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Lệch tăng</span><b className="text-emerald-700">{formatVnd(lines.reduce((s, l) => s + Math.max(0, Number(l.actualQty ?? 0) - Number(l.onHand ?? 0)), 0))}</b></div>
              <div className="flex justify-between"><span>Lệch giảm</span><b className="text-rose-600">{formatVnd(lines.reduce((s, l) => s + Math.min(0, Number(l.actualQty ?? 0) - Number(l.onHand ?? 0)), 0))}</b></div>
              <label className="flex items-start gap-2 pt-1"><input type="checkbox" className="mt-0.5" checked={form.zeroMissing} onChange={e => setForm({ ...form, zeroMissing: e.target.checked })} />Đưa tồn kho các hàng không có trong phiếu về 0</label>
            </div>
          )}
          <Field label="Ghi chú"><textarea className="input" rows={3} disabled={mode === 'view'} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field>
          {mode === 'edit' && (
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button type="button" className="btn" disabled={busy || !lines.length} onClick={() => submit(false)}>Lưu tạm</button>
              <button type="button" className="btn-primary" disabled={busy || !lines.length || (kind === 'transfer' && !form.toBranchId)} onClick={() => submit(true)}>{cfg.completeLabel}</button>
            </div>
          )}
          {mode === 'receive' && (receivingHere
            ? <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => submit(true)}>Nhận hàng</button>
            : <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Chuyển sang chi nhánh nhận để xác nhận nhận hàng.</p>)}
        </aside>
      </div>
    );
  };
}
