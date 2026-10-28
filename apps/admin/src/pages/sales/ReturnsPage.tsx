import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal } from '../../components/Modal';
import { CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, resolveDateRange, useListState, type Column } from '../../components/list';
import { SaleReturnDialog } from './SaleReturnDialog';

type Row = { id: number; code: string; createdAt: string; invoiceCode: string; customerName: string; subtotal: number; returnFee: number; total: number; refunded: number; toDebt: number; status: string; refundMethod: string; createdByName: string };
type Detail = Row & { lines: { id: number; productCode: string; productName: string; qty: number; price: number; amount: number }[]; exchangeInvoice: { code: string; total: number } | null };

export function ReturnsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ date: 'thisMonth', status: ['completed'] as string[] });
  const [quick, setQuick] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const range = resolveDateRange(state.date as string);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], ...range };
  const list = useQuery({ queryKey: ['returns', query], queryFn: () => api<{ items: Row[]; total: number; totals: Record<string, number> }>('/returns', { query }) });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/returns/${id}/cancel`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); toast('Đã hủy phiếu trả hàng'); }, onError: toastError });
  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã trả hàng' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) }, { key: 'invoiceCode', header: 'Hóa đơn' },
    { key: 'customerName', header: 'Khách hàng' }, { key: 'subtotal', header: 'Tổng tiền hàng trả', money: true, total: true }, { key: 'returnFee', header: 'Phí trả hàng', money: true, total: true },
    { key: 'total', header: 'Cần trả khách', money: true, total: true }, { key: 'refunded', header: 'Đã trả khách', money: true, total: true },
    { key: 'status', header: 'Trạng thái', render: r => (r.status === 'cancelled' ? <span className="text-rose-600">Đã hủy</span> : 'Đã trả') },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Trả hàng">
          <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
          <FilterSection title="Trạng thái"><CheckboxFilter options={[{ value: 'completed', label: 'Đã trả' }, { value: 'cancelled', label: 'Đã hủy' }]} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
        </FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã phiếu trả" onCreate={can('returns.create') ? () => setQuick(true) : undefined} createLabel="Trả hàng nhanh" onExport={() => download('/returns/export', query, 'tra-hang.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="returns" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => <ReturnDetail id={r.id} onCancel={() => setCancelId(r.id)} canCancel={can('returns.delete')} />} />
      </ListPage>
      <SaleReturnDialog invoiceId={quick ? 0 : null} onClose={() => setQuick(false)} />
      <ConfirmModal open={cancelId !== null} danger title="Hủy phiếu trả hàng" confirmLabel="Hủy phiếu" onClose={() => setCancelId(null)} message="Tồn kho, tiền và công nợ của phiếu sẽ được hoàn lại." onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </>
  );
}

function ReturnDetail({ id, onCancel, canCancel }: { id: number; onCancel: () => void; canCancel: boolean }) {
  const q = useQuery({ queryKey: ['return', id], queryFn: () => api<Detail>(`/returns/${id}`) });
  if (!q.data) return <div className="p-4 text-slate-400">Đang tải...</div>;
  const d = q.data;
  return (
    <div className="space-y-2 p-4 text-sm">
      <table className="w-full"><tbody>{d.lines.map(l => <tr key={l.id} className="border-t border-slate-100"><td className="py-1">{l.productCode}</td><td>{l.productName}</td><td className="num">{l.qty}</td><td className="num">{formatVnd(l.price)}</td><td className="num">{formatVnd(l.amount)}</td></tr>)}</tbody></table>
      {d.exchangeInvoice && <div>Đổi sang hóa đơn <b>{d.exchangeInvoice.code}</b> ({formatVnd(d.exchangeInvoice.total)})</div>}
      <div className="flex justify-end">{d.status !== 'cancelled' && canCancel && <button type="button" className="btn text-rose-600" onClick={onCancel}>Hủy phiếu</button>}</div>
    </div>
  );
}
