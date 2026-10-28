import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { DELIVERY_STATUSES } from '../delivery/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { openInPos } from '../../lib/pos';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter, resolveDateRange, useListState, type Column } from '../../components/list';
import { printInvoice } from './printInvoice';
import { SaleReturnDialog } from './SaleReturnDialog';

type Row = { id: number; code: string; createdAt: string; returnCodes: string[]; customerCode: string; customerName: string; subtotal: number; promoDiscount: number; invoiceDiscount: number; voucherDiscount: number; total: number; paid: number; debt: number; status: string; channel: string; sellerName: string; isDelivery: boolean };
type Detail = Row & { lines: { id: number; productCode: string; productName: string; unit: string; qty: number; price: number; discount: number; promoDiscount: number; amount: number; isGift: boolean; returnedQty?: number }[]; payments: { id: number; method: string; amount: number; voucherCode: string | null; fundName: string }[]; returns: { id: number; code: string; status: string; total: number; createdAt: string }[]; history: { id: number; createdAt: string; summary: string }[]; delivery: { receiverName: string; receiverPhone: string; address: string; fee: number; cod: number; status: string } | null; promotions: { name: string; amount: number }[]; pointsUsed?: number; pointsEarned?: number; note?: string };

export const INVOICE_STATUS: Record<string, string> = { processing: 'Đang xử lý', completed: 'Hoàn thành', undeliverable: 'Không giao được', cancelled: 'Đã hủy' };
const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', ewallet: 'Ví điện tử', points: 'Điểm', deposit: 'Tiền cọc', exchange: 'Hàng trả' };

function Expanded({ id, onCancel, onReturn }: { id: number; onCancel: () => void; onReturn: () => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<Detail>(`/invoices/${id}`) });
  const d = q.data;
  if (!d) return <div className="p-4 text-slate-400">Đang tải...</div>;
  return (
    <div>
      <Tabs tabs={[
        {
          key: 'info', label: 'Thông tin', content: () => (
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-x-6 text-sm md:grid-cols-4">
                <div><span className="text-slate-500">Mã hóa đơn: </span><b>{d.code}</b></div><div><span className="text-slate-500">Thời gian: </span>{formatDateTime(d.createdAt)}</div>
                <div><span className="text-slate-500">Khách hàng: </span>{d.customerName}</div><div><span className="text-slate-500">Người bán: </span>{d.sellerName}</div>
                <div><span className="text-slate-500">Kênh bán: </span>{d.channel}</div><div><span className="text-slate-500">Trạng thái: </span>{INVOICE_STATUS[d.status]}</div>
                {d.note && <div className="col-span-2"><span className="text-slate-500">Ghi chú: </span>{d.note}</div>}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1.5 text-left">Mã hàng</th><th className="text-left">Tên hàng</th><th className="text-right">SL</th><th className="text-right">Đơn giá</th><th className="text-right">Giảm giá</th><th className="px-2 text-right">Thành tiền</th></tr></thead>
                <tbody>{d.lines.map(l => <tr key={l.id} className="border-t border-slate-100"><td className="px-2 py-1">{l.productCode}</td><td>{l.productName}{l.isGift ? ' (quà tặng)' : ''}</td><td className="num">{l.qty}</td><td className="num">{formatVnd(l.price)}</td><td className="num">{formatVnd(l.discount + l.promoDiscount)}</td><td className="num px-2">{formatVnd(l.amount)}</td></tr>)}</tbody>
              </table>
              <div className="ml-auto max-w-sm space-y-1 text-sm">
                <div className="flex justify-between"><span>Tổng tiền hàng</span><span>{formatVnd(d.subtotal)}</span></div>
                <div className="flex justify-between"><span>Giảm giá hóa đơn</span><span>{formatVnd(d.invoiceDiscount + d.voucherDiscount)}</span></div>
                {d.promotions.map(p => <div key={p.name} className="flex justify-between text-amber-800"><span>{p.name}</span><span>-{formatVnd(p.amount)}</span></div>)}
                <div className="flex justify-between font-semibold"><span>Khách cần trả</span><span>{formatVnd(d.total)}</span></div>
                {d.payments.map(p => <div key={p.id} className="flex justify-between"><span>{METHOD[p.method] ?? p.method}{p.voucherCode ? ` (${p.voucherCode})` : ''}</span><span>{formatVnd(p.amount)}</span></div>)}
                {d.debt > 0 && <div className="flex justify-between text-rose-700"><span>Còn nợ</span><span>{formatVnd(d.debt)}</span></div>}
              </div>
              {d.delivery && <div className="flex flex-wrap items-center gap-2 rounded bg-sky-50 p-2 text-sm">Giao hàng: {d.delivery.receiverName} · {d.delivery.receiverPhone} · {d.delivery.address} · Phí {formatVnd(d.delivery.fee)} · COD {formatVnd(d.delivery.cod)} · <b>{DELIVERY_STATUSES.find(s => s.value === d.delivery!.status)?.label}</b><Link to="/waybills" className="ml-auto text-brand-700 hover:underline">Xem vận đơn</Link></div>}
            </div>
          ),
        },
        { key: 'returns', label: `Trả hàng (${d.returns.length})`, content: () => <div className="p-4 text-sm">{d.returns.length ? d.returns.map(r => <div key={r.id}>{r.code} · {formatDateTime(r.createdAt)} · {formatVnd(r.total)} · {r.status === 'cancelled' ? 'Đã hủy' : 'Hoàn thành'}</div>) : 'Chưa có phiếu trả hàng'}</div> },
        { key: 'history', label: 'Lịch sử', content: () => <div className="p-4 text-sm">{d.history.map(h => <div key={h.id}>{formatDateTime(h.createdAt)} · {h.summary}</div>)}</div> },
      ]} />
      <div className="flex flex-wrap justify-end gap-2 px-4 pb-4">
        <button type="button" className="btn" onClick={() => printInvoice(d.id).catch(toastError)}>In</button>
        {can('invoices.create') && <button type="button" className="btn" onClick={() => openInPos({ type: 'copy', invoiceId: d.id })}>Sao chép</button>}
        {d.status === 'completed' && can('returns.create') && <button type="button" className="btn" onClick={onReturn}>Trả hàng</button>}
        {d.status !== 'cancelled' && can('invoices.delete') && <button type="button" className="btn text-rose-600" onClick={onCancel}>Hủy</button>}
      </div>
    </div>
  );
}

export function InvoicesPage() {
  const qc = useQueryClient();
  const { state, set } = useListState({ date: 'thisMonth', status: ['processing', 'completed', 'undeliverable'] as string[], delivery: '', returnState: '', methods: [] as string[], customer: '' });
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [returnId, setReturnId] = useState<number | null>(null);
  const range = resolveDateRange(state.date as string);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], delivery: (state.delivery as string) || undefined, returnState: (state.returnState as string) || undefined, methods: state.methods as string[], customer: (state.customer as string) || undefined, ...range };
  const list = useQuery({ queryKey: ['invoices', query], queryFn: () => api<{ items: Row[]; total: number; totals: Record<string, number> }>('/invoices', { query }) });
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/invoices/${id}/cancel`, { body: {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice'] }); toast('Đã hủy hóa đơn'); }, onError: toastError,
  });
  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã hóa đơn' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
    { key: 'returnCodes', header: 'Mã trả hàng', render: r => r.returnCodes.join(', ') }, { key: 'customerCode', header: 'Mã KH' }, { key: 'customerName', header: 'Khách hàng' },
    { key: 'subtotal', header: 'Tổng tiền hàng', money: true, total: true }, { key: 'discount', header: 'Giảm giá', money: true, total: true, render: r => formatVnd(r.promoDiscount + r.invoiceDiscount + r.voucherDiscount) },
    { key: 'total', header: 'Khách cần trả', money: true, total: true, hiddenByDefault: true }, { key: 'paid', header: 'Khách đã trả', money: true, total: true },
    { key: 'debt', header: 'Còn nợ', money: true, total: true, hiddenByDefault: true }, { key: 'sellerName', header: 'Người bán', hiddenByDefault: true },
    { key: 'status', header: 'Trạng thái', render: r => <span className={r.status === 'cancelled' ? 'text-rose-600' : r.status === 'completed' ? 'text-emerald-700' : 'text-sky-700'}>{INVOICE_STATUS[r.status]}</span> },
  ];
  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Hóa đơn">
            <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
            <FilterSection title="Trạng thái"><CheckboxFilter options={Object.entries(INVOICE_STATUS).map(([value, label]) => ({ value, label }))} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
            <FilterSection title="Giao hàng" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'true', label: 'Có giao hàng' }, { value: 'false', label: 'Không giao hàng' }]} value={state.delivery as string} onChange={v => set({ delivery: v })} /></FilterSection>
            <FilterSection title="Trả hàng" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'none', label: 'Chưa trả hàng' }, { value: 'returned', label: 'Đã trả hàng' }]} value={state.returnState as string} onChange={v => set({ returnState: v })} /></FilterSection>
            <FilterSection title="Phương thức thanh toán" defaultOpen={false}><CheckboxFilter options={Object.entries(METHOD).map(([value, label]) => ({ value, label }))} value={state.methods as string[]} onChange={v => set({ methods: v })} /></FilterSection>
            <FilterSection title="Khách hàng" defaultOpen={false}><input className="input" placeholder="Tên, mã hoặc SĐT" value={state.customer as string} onChange={e => set({ customer: e.target.value })} /></FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã hóa đơn" onExport={() => download('/invoices/export', query, 'hoa-don.xlsx')}
          extra={<a className="btn-primary" href="/sale/" target="_blank" rel="noreferrer">Bán hàng</a>} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="hóa đơn" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="invoices" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => <Expanded id={r.id} onCancel={() => setCancelId(r.id)} onReturn={() => setReturnId(r.id)} />} />
      </ListPage>
      <ConfirmModal open={cancelId !== null} danger title="Hủy hóa đơn" confirmLabel="Hủy hóa đơn" onClose={() => setCancelId(null)}
        message="Hủy hóa đơn sẽ hoàn lại tồn kho, công nợ, điểm và phiếu thu liên quan. Bạn có chắc chắn?" onConfirm={() => cancelId && cancel.mutate(cancelId)} />
      <SaleReturnDialog invoiceId={returnId} onClose={() => setReturnId(null)} />
    </>
  );
}
