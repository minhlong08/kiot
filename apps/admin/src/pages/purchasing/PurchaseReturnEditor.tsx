import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { DocumentLinesEditor, type DocLine } from '../../components/docs/DocumentLinesEditor';
import { SupplierPicker, type PickedSupplier } from './SupplierPicker';

type Loaded = { id: number; code: string; status: string; supplierId: number; supplierCode: string; supplierName: string; receiptId: number | null; receiptCode: string | null; createdAt: string; discount: number; refund: number; fundId: number | null; note: string; lines: Record<string, unknown>[] };

const toLine = (l: Record<string, unknown>): DocLine => ({ ...l, productId: Number(l.productId), unitId: (l.unitId as number | null) ?? null, code: String(l.productCode), name: String(l.productName), unit: String(l.unit ?? ''), qty: Number(l.qty), price: Number(l.price) });

/** Lines from a receipt carry maxQty (still returnable); quantities are clamped to it. */
const clamp = (lines: DocLine[]) => lines.map(l => (l.maxQty !== undefined && Number(l.qty) > Number(l.maxQty) ? { ...l, qty: Number(l.maxQty) } : l));

export function PurchaseReturnEditor() {
  const params = useParams({ strict: false }) as { id?: string };
  const id = params.id && params.id !== 'new' ? Number(params.id) : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [receipt, setReceipt] = useState<{ id: number; code: string } | null>(null);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [f, setF] = useState({ discount: 0, refund: 0, fundId: null as number | null, note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) {
      api<Loaded>(`/purchase-returns/${id}`).then(d => {
        setDoc(d);
        setSupplier({ id: d.supplierId, code: d.supplierCode, name: d.supplierName });
        setReceipt(d.receiptId ? { id: d.receiptId, code: d.receiptCode ?? '' } : null);
        setLines(d.lines.map(toLine));
        setF({ discount: d.discount, refund: d.refund, fundId: d.fundId, note: d.note });
      }, toastError);
      return;
    }
    const from = new URLSearchParams(window.location.search).get('fromReceipt');
    if (from) {
      api<{ supplierId: number; receiptId: number; receiptCode: string; lines: Record<string, unknown>[] }>(`/purchase-receipts/${from}/return-draft`).then(async d => {
        setSupplier(await api<PickedSupplier>(`/suppliers/${d.supplierId}`));
        setReceipt({ id: d.receiptId, code: d.receiptCode });
        setLines(d.lines.map(l => ({ ...toLine(l), maxQty: Number(l.qty) })));
      }, toastError);
    }
  }, [id]);

  const editable = !doc || doc.status === 'draft';
  const subtotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0);
  const total = Math.max(0, subtotal - f.discount);

  async function submit(complete: boolean) {
    if (!supplier) return toastError(new Error('Chọn nhà cung cấp'));
    setBusy(true);
    try {
      const body = { supplierId: supplier.id, receiptId: receipt?.id ?? null, discount: f.discount, refund: f.refund, fundId: f.fundId, note: f.note, complete, lines: lines.map(l => ({ productId: l.productId, unitId: l.unitId ?? null, qty: Number(l.qty), price: Number(l.price) })) };
      const saved = await api<{ code: string }>(id ? `/purchase-returns/${id}` : '/purchase-returns', { method: id ? 'PUT' : 'POST', body });
      await Promise.all(['purchase-returns', 'purchase-receipts', 'products', 'suppliers'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      toast(`Đã lưu ${saved.code}`);
      navigate({ to: '/purchase-returns' });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
          <button type="button" className="btn-ghost" aria-label="Quay lại" onClick={() => navigate({ to: '/purchase-returns' })}><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-semibold">Trả hàng nhập{receipt ? ` - ${receipt.code}` : ''}</h1>
          {doc && <DocStatusBadge status={doc.status} />}
        </div>
        <DocumentLinesEditor lines={lines} onChange={ls => setLines(clamp(ls))} qtyKey="qty" readOnly={!editable} allowUnits
          columns={[
            ...(receipt ? [{ key: 'maxQty', header: 'Còn được trả', kind: 'readonly' as const }] : []),
            { key: 'qty', header: 'Số lượng trả', kind: 'qty' as const },
            { key: 'price', header: 'Giá trả', kind: 'money' as const },
            { key: 'amount', header: 'Thành tiền', kind: 'readonlyMoney' as const, value: l => Number(l.qty) * Number(l.price) },
          ]}
          newLine={r => ({ qty: 1, price: r.cost ?? 0 })} />
      </div>
      <aside className="w-full space-y-3 border-l border-slate-200 bg-slate-50 p-4 lg:w-96">
        <div className="flex justify-between text-sm text-slate-600"><span>{me?.user.fullName}</span><span>{formatDateTime(doc?.createdAt ?? new Date())}</span></div>
        <SupplierPicker value={supplier} onChange={setSupplier} disabled={!editable || !!receipt} />
        <div className="flex justify-between text-sm"><span>Tổng tiền hàng</span><span>{formatVnd(subtotal)}</span></div>
        <div className="flex items-center justify-between text-sm"><span>Giảm giá</span><MoneyInput className="w-36" value={f.discount} disabled={!editable} onChange={discount => setF({ ...f, discount })} aria-label="Giảm giá phiếu" /></div>
        <div className="flex justify-between text-sm font-semibold"><span>NCC cần trả</span><span data-testid="total-due" className="text-brand-700">{formatVnd(total)}</span></div>
        <div className="flex items-center justify-between text-sm"><span>Tiền NCC trả</span><MoneyInput className="w-36" value={f.refund} disabled={!editable} onChange={refund => setF({ ...f, refund: Math.min(refund, total) })} aria-label="Tiền NCC trả" /></div>
        <Field label="Nhận vào quỹ"><FundSelect value={f.fundId} onChange={fundId => setF({ ...f, fundId })} /></Field>
        <div className="flex justify-between text-sm"><span>Tính vào công nợ</span><span>{formatVnd(total - f.refund)}</span></div>
        <Field label="Ghi chú"><textarea className="input" rows={2} disabled={!editable} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        {editable && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" disabled={busy || !lines.length || !supplier} onClick={() => submit(false)}>Lưu tạm</button>
            <button type="button" className="btn-primary" disabled={busy || !lines.length || !supplier} onClick={() => submit(true)}>Hoàn thành</button>
          </div>
        )}
      </aside>
    </div>
  );
}
