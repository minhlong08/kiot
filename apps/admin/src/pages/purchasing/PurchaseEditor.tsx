import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { formatDateTime, formatVnd, receiptTotals } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { DocumentLinesEditor, type DocLine } from '../../components/docs/DocumentLinesEditor';
import { SupplierPicker, type PickedSupplier } from './SupplierPicker';
import { LinesImport } from './LinesImport';

type Kind = 'receipt' | 'order';
const CFG = {
  receipt: { title: 'Nhập hàng', api: '/purchase-receipts', route: '/purchase-receipts', complete: 'Hoàn thành', flag: 'complete' },
  order: { title: 'Đặt hàng nhập', api: '/purchase-orders', route: '/purchase-orders', complete: 'Đặt hàng', flag: 'confirm' },
} as const;

type Loaded = { id: number; code: string; status: string; total?: number; supplierId: number; supplierCode: string; supplierName: string; createdAt: string; note: string; discount: number; otherCosts?: number; paid?: number; invoiceNo?: string; purchaseOrderId?: number | null; purchaseOrderCode?: string | null; fundId?: number | null; lines: Record<string, unknown>[] };

const toLine = (l: Record<string, unknown>): DocLine => ({ ...l, productId: Number(l.productId), unitId: (l.unitId as number | null) ?? null, code: String(l.productCode), name: String(l.productName), unit: String(l.unit ?? ''), qty: Number(l.qty), unitCost: Number(l.unitCost), discount: Number(l.discount ?? 0) });

function Row({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}><span>{label}</span><span>{children}</span></div>;
}

export function makePurchaseEditor(kind: Kind) {
  return function PurchaseEditor() {
    const cfg = CFG[kind];
    const params = useParams({ strict: false }) as { id?: string };
    const id = params.id && params.id !== 'new' ? Number(params.id) : undefined;
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { me } = useAuth();
    const [doc, setDoc] = useState<Loaded | null>(null);
    const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
    const [lines, setLines] = useState<DocLine[]>([]);
    const [f, setF] = useState({ code: '', invoiceNo: '', discount: 0, otherCosts: 0, paid: 0, paidTouched: false, fundId: null as number | null, note: '', purchaseOrderId: null as number | null, purchaseOrderCode: '' });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      if (id) {
        api<Loaded>(`${cfg.api}/${id}`).then(d => {
          setDoc(d);
          setSupplier({ id: d.supplierId, code: d.supplierCode, name: d.supplierName });
          setLines(d.lines.map(toLine));
          setF(x => ({ ...x, code: d.code, invoiceNo: d.invoiceNo ?? '', discount: d.discount, otherCosts: d.otherCosts ?? 0, paid: d.paid ?? 0, paidTouched: (d.paid ?? 0) !== (d.total ?? 0), fundId: d.fundId ?? null, note: d.note, purchaseOrderId: d.purchaseOrderId ?? null, purchaseOrderCode: d.purchaseOrderCode ?? '' }));
        }, toastError);
        return;
      }
      const fromOrder = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fromOrder') : null;
      if (kind === 'receipt' && fromOrder) {
        api<{ supplierId: number; purchaseOrderId: number; purchaseOrderCode: string; lines: Record<string, unknown>[] }>(`/purchase-orders/${fromOrder}/receipt-draft`).then(async d => {
          const s = await api<PickedSupplier>(`/suppliers/${d.supplierId}`);
          setSupplier(s);
          setLines(d.lines.map(toLine));
          setF(x => ({ ...x, purchaseOrderId: d.purchaseOrderId, purchaseOrderCode: d.purchaseOrderCode }));
        }, toastError);
      }
    }, [id, cfg.api]);

    const editable = !doc || doc.status === 'draft' || (kind === 'order' && doc.status === 'confirmed');
    const costLines = lines.map(l => ({ qty: Number(l.qty), conversion: Number(l.conversion ?? 1), unitCost: Number(l.unitCost), discount: Number(l.discount) }));
    const totals = useMemo(() => receiptTotals(costLines, f.discount, kind === 'receipt' ? f.otherCosts : 0), [JSON.stringify(costLines), f.discount, f.otherCosts]); // eslint-disable-line react-hooks/exhaustive-deps
    const paid = f.paidTouched ? f.paid : totals.total;
    const qtyTotal = lines.reduce((s, l) => s + Number(l.qty), 0);

    async function submit(complete: boolean) {
      if (!supplier) return toastError(new Error('Chọn nhà cung cấp'));
      setBusy(true);
      try {
        const body = {
          code: id ? undefined : f.code || undefined, supplierId: supplier.id, note: f.note, discount: f.discount,
          lines: lines.map(l => ({ productId: l.productId, unitId: l.unitId ?? null, qty: Number(l.qty), unitCost: Number(l.unitCost), discount: Number(l.discount) })),
          ...(kind === 'receipt' ? { invoiceNo: f.invoiceNo, otherCosts: f.otherCosts, paid: complete ? paid : Math.min(paid, totals.total), fundId: f.fundId, purchaseOrderId: f.purchaseOrderId } : {}),
          [cfg.flag]: complete,
        };
        const saved = await api<{ id: number; code: string }>(id ? `${cfg.api}/${id}` : cfg.api, { method: id ? 'PUT' : 'POST', body });
        await Promise.all([cfg.api.slice(1), 'products', 'suppliers', 'purchase-orders'].map(k => qc.invalidateQueries({ queryKey: [k] })));
        toast(`Đã lưu ${saved.code}`);
        navigate({ to: cfg.route });
      } catch (e) { toastError(e); } finally { setBusy(false); }
    }

    const columns = [
      { key: 'qty', header: 'Số lượng', kind: 'qty' as const },
      { key: 'unitCost', header: 'Đơn giá', kind: 'money' as const },
      { key: 'discount', header: 'Giảm giá', kind: 'money' as const },
      { key: 'amount', header: 'Thành tiền', kind: 'readonlyMoney' as const, value: (l: DocLine) => Number(l.qty) * Number(l.unitCost) - Number(l.discount) },
    ];

    return (
      <div className="flex h-full flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
            <button type="button" className="btn-ghost" aria-label="Quay lại" onClick={() => navigate({ to: cfg.route })}><ArrowLeft size={18} /></button>
            <h1 className="text-lg font-semibold">{cfg.title}</h1>
            {doc && <DocStatusBadge status={doc.status} />}
          </div>
          <DocumentLinesEditor lines={lines} onChange={setLines} qtyKey="qty" columns={columns} readOnly={!editable} allowUnits
            newLine={r => ({ qty: 1, unitCost: r.cost ?? 0, discount: 0 })}
            emptyHint={editable ? <LinesImport onLines={ls => setLines(ls.map(toLine))} /> : undefined} />
        </div>
        <aside className="w-full space-y-3 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 lg:w-96">
          <div className="flex justify-between text-sm text-slate-600"><span>{me?.user.fullName}</span><span>{formatDateTime(doc?.createdAt ?? new Date())}</span></div>
          <SupplierPicker value={supplier} onChange={setSupplier} disabled={!editable || !!doc} />
          <Field label={kind === 'receipt' ? 'Mã phiếu nhập' : 'Mã đặt hàng nhập'}><input className="input" placeholder="Mã phiếu tự động" disabled={!!id} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
          {kind === 'receipt' && f.purchaseOrderCode && <Row label="Mã đặt hàng nhập"><b className="text-brand-700">{f.purchaseOrderCode}</b></Row>}
          <Row label="Trạng thái">{doc ? <DocStatusBadge status={doc.status} /> : 'Phiếu tạm'}</Row>
          {kind === 'receipt' && <Field label="Số hóa đơn đầu vào"><input className="input" disabled={!editable} value={f.invoiceNo} onChange={e => setF({ ...f, invoiceNo: e.target.value })} /></Field>}
          <Row label={<>Tổng tiền hàng <span className="rounded bg-slate-200 px-1.5 text-xs">{qtyTotal}</span></>}>{formatVnd(totals.subtotal)}</Row>
          <Row label="Giảm giá"><MoneyInput className="w-36" value={f.discount} disabled={!editable} onChange={discount => setF({ ...f, discount })} aria-label="Giảm giá phiếu" /></Row>
          {kind === 'receipt' && <Row label="Chi phí nhập khác"><MoneyInput className="w-36" value={f.otherCosts} disabled={!editable} onChange={otherCosts => setF({ ...f, otherCosts })} aria-label="Chi phí nhập khác" /></Row>}
          <Row label={kind === 'receipt' ? 'Cần trả nhà cung cấp' : 'Tổng cộng'} strong><span data-testid="total-due" className="text-brand-700">{formatVnd(totals.total)}</span></Row>
          {kind === 'receipt' && (
            <>
              <Row label="Tiền trả nhà cung cấp"><MoneyInput className="w-36" value={paid} disabled={!editable} onChange={v => setF({ ...f, paid: v, paidTouched: true })} aria-label="Tiền trả nhà cung cấp" /></Row>
              <Field label="Trả từ quỹ"><FundSelect value={f.fundId} disabled={!editable} onChange={fundId => setF({ ...f, fundId })} /></Field>
              <Row label="Tính vào công nợ"><span className={totals.total - paid > 0 ? 'text-rose-700' : ''}>{formatVnd(totals.total - paid)}</span></Row>
            </>
          )}
          <Field label="Ghi chú"><textarea className="input" rows={2} disabled={!editable} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
          {editable && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button type="button" className="btn" disabled={busy || !lines.length || !supplier} onClick={() => submit(false)}>Lưu tạm</button>
              <button type="button" className="btn-primary" disabled={busy || !lines.length || !supplier} onClick={() => submit(true)}>{cfg.complete}</button>
            </div>
          )}
        </aside>
      </div>
    );
  };
}

export const ReceiptEditor = makePurchaseEditor('receipt');
export const PurchaseOrderEditor = makePurchaseEditor('order');
