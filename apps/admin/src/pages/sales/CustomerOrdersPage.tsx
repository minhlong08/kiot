import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { openInPos } from '../../lib/pos';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, resolveDateRange, useListState, type Column } from '../../components/list';

type Row = { id: number; code: string; createdAt: string; customerName: string; total: number; deposit: number; depositUsed: number; status: string; note: string };
type Detail = Row & { lines: { id: number; productCode: string; productName: string; unit: string; qty: number; price: number; deliveredQty: number }[]; invoices: { id: number; code: string; total: number; status: string }[] };
const STATUSES = [{ value: 'pending', label: 'Chờ xác nhận' }, { value: 'draft', label: 'Phiếu tạm' }, { value: 'confirmed', label: 'Đã xác nhận' }, { value: 'partial', label: 'Giao một phần' }, { value: 'completed', label: 'Hoàn thành' }, { value: 'cancelled', label: 'Đã hủy' }];

export function CustomerOrdersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { state, set } = useListState({ date: 'thisMonth', status: ['pending', 'draft', 'confirmed', 'partial'] as string[] });
  const [deposit, setDeposit] = useState<{ id: number; amount: number; fundId: number | null } | null>(null);
  const range = resolveDateRange(state.date as string);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], ...range };
  const list = useQuery({ queryKey: ['customer-orders', query], queryFn: () => api<{ items: Row[]; total: number; totals: Record<string, number> }>('/customer-orders', { query }) });
  const run = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer-orders'] }); qc.invalidateQueries({ queryKey: ['customer-order'] }); toast('Đã cập nhật'); }, onError: toastError });
  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã đặt hàng' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) }, { key: 'customerName', header: 'Khách hàng' },
    { key: 'total', header: 'Tổng cộng', money: true, total: true }, { key: 'deposit', header: 'Đã cọc', money: true, total: true },
    { key: 'status', header: 'Trạng thái', render: r => <DocStatusBadge status={r.status === 'partial' ? 'partial' : r.status} /> },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Đặt hàng">
          <FilterSection title="Trạng thái"><CheckboxFilter options={STATUSES} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
          <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
        </FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã đặt hàng" onCreate={can('customerOrders.create') ? () => navigate({ to: '/customer-orders/new' }) : undefined} createLabel="Đặt hàng" onExport={() => download('/customer-orders/export', query, 'dat-hang.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="đơn" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="customer-orders" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => <OrderDetail id={r.id} actions={{
            open: () => navigate({ to: `/customer-orders/${r.id}` }),
            confirm: () => run.mutate(() => api(`/customer-orders/${r.id}/confirm`, { body: {} })),
            invoice: () => openInPos({ type: 'order', orderId: r.id }),
            deposit: () => setDeposit({ id: r.id, amount: 0, fundId: null }),
            cancel: () => run.mutate(() => api(`/customer-orders/${r.id}/cancel`, { body: {} })),
          }} />} />
      </ListPage>
      <Modal open={!!deposit} size="sm" title="Thêm tiền cọc" onClose={() => setDeposit(null)}
        footer={<button type="button" className="btn-primary" disabled={!deposit?.amount} onClick={() => { const d = deposit!; setDeposit(null); run.mutate(() => api(`/customer-orders/${d.id}/deposit`, { body: { amount: d.amount, fundId: d.fundId } })); }}>Lưu</button>}>
        {deposit && <div className="space-y-3"><Field label="Số tiền"><MoneyInput value={deposit.amount} onChange={amount => setDeposit({ ...deposit, amount })} /></Field><Field label="Quỹ"><FundSelect value={deposit.fundId} onChange={fundId => setDeposit({ ...deposit, fundId })} /></Field></div>}
      </Modal>
    </>
  );
}

function OrderDetail({ id, actions }: { id: number; actions: Record<'open' | 'confirm' | 'invoice' | 'deposit' | 'cancel', () => void> }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['customer-order', id], queryFn: () => api<Detail>(`/customer-orders/${id}`) });
  if (!q.data) return <div className="p-4 text-slate-400">Đang tải...</div>;
  const d = q.data;
  const open = ['confirmed', 'partial'].includes(d.status);
  return (
    <div className="space-y-2 p-4 text-sm">
      <table className="w-full"><thead className="text-xs text-slate-500"><tr><th className="text-left">Mã hàng</th><th className="text-left">Tên hàng</th><th className="text-right">SL đặt</th><th className="text-right">Đã giao</th><th className="text-right">Đơn giá</th></tr></thead>
        <tbody>{d.lines.map(l => <tr key={l.id} className="border-t border-slate-100"><td className="py-1">{l.productCode}</td><td>{l.productName}</td><td className="num">{l.qty}</td><td className="num">{l.deliveredQty}</td><td className="num">{formatVnd(l.price)}</td></tr>)}</tbody></table>
      <div>Đã cọc: <b>{formatVnd(d.deposit)}</b> · Đã dùng: {formatVnd(d.depositUsed)}{d.invoices.length ? ` · Hóa đơn: ${d.invoices.map(i => i.code).join(', ')}` : ''}</div>
      <div className="flex flex-wrap justify-end gap-2">
        {d.status === 'draft' && can('customerOrders.edit') && <><button type="button" className="btn" onClick={actions.open}>Mở phiếu</button><button type="button" className="btn-primary" onClick={actions.confirm}>Xác nhận</button></>}
        {open && can('customerOrders.edit') && <button type="button" className="btn" onClick={actions.deposit}>Thêm cọc</button>}
        {open && can('invoices.create') && <button type="button" className="btn-primary" onClick={actions.invoice}>Lập hóa đơn</button>}
        {!['completed', 'cancelled'].includes(d.status) && can('customerOrders.delete') && <button type="button" className="btn text-rose-600" onClick={actions.cancel}>Hủy</button>}
      </div>
    </div>
  );
}
