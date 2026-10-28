import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { DataTable, Pagination, useListState, type Column } from '../../components/list';

type Order = { id: number; code: string; createdAt: string; channel: string; channelName: string; status: string; total: number; note: string; customer: { code: string; name: string; phone: string } | null; lines: { id: number; productCode: string; productName: string; qty: number; price: number }[] };
const TABS = [{ value: 'pending', label: 'Chờ xác nhận' }, { value: 'confirmed', label: 'Đã xác nhận' }, { value: 'partial', label: 'Giao một phần' }, { value: 'completed', label: 'Hoàn thành' }, { value: 'cancelled', label: 'Đã hủy' }];

/** Orders from the website and other online channels; confirming one reserves stock like any customer order. */
export function OnlineOrdersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ tab: 'pending' });
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: [state.tab as string] };
  const list = useQuery({ queryKey: ['online-orders', query], queryFn: () => api<{ items: Order[]; total: number; statusCounts: Record<string, number> }>('/online-orders', { query }) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'accept' | 'reject' }) => api(`/customer-orders/${id}/${action}`, { body: {} }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['online-orders'] }); qc.invalidateQueries({ queryKey: ['customer-orders'] }); toast(v.action === 'accept' ? 'Đã xác nhận đơn' : 'Đã từ chối đơn'); },
    onError: toastError,
  });
  const columns: Column<Order>[] = [
    { key: 'code', header: 'Mã đơn' }, { key: 'createdAt', header: 'Thời gian', render: o => formatDateTime(o.createdAt) }, { key: 'channelName', header: 'Kênh' },
    { key: 'customer', header: 'Khách hàng', render: o => (o.customer ? <><div>{o.customer.name}</div><div className="text-xs text-slate-500">{o.customer.phone}</div></> : 'Khách lẻ') },
    { key: 'total', header: 'Tổng tiền', align: 'right', money: true },
  ];
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Đơn hàng online</h1>
        <input className="input max-w-xs" placeholder="Theo mã đơn, địa chỉ" aria-label="Tìm kiếm" value={state.search} onChange={e => set({ search: e.target.value })} />
      </div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.value} type="button" onClick={() => set({ tab: t.value, page: 1 })} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', state.tab === t.value ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500')}>
            {t.label}<span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs">{list.data?.statusCounts[t.value] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        <DataTable tableId="online-orders" columns={columns} rows={list.data?.items ?? []} getRowId={o => o.id} loading={list.isLoading}
          renderExpanded={o => (
            <div className="space-y-3 p-4 text-sm">
              {o.note && <p className="whitespace-pre-line rounded bg-amber-50 p-2">{o.note}</p>}
              <table className="w-full"><tbody>{o.lines.map(l => <tr key={l.id} className="border-t border-slate-100"><td className="py-1">{l.productCode}</td><td>{l.productName}</td><td className="text-right">{l.qty}</td><td className="text-right tabular-nums">{formatVnd(l.price)}</td></tr>)}</tbody></table>
              <div className="flex justify-end gap-2">
                <Link to="/customer-orders/$id" params={{ id: String(o.id) }} className="btn">Mở đơn</Link>
                {o.status === 'pending' && can('customerOrders.delete') && <button type="button" className="btn text-rose-600" onClick={() => act.mutate({ id: o.id, action: 'reject' })}>Từ chối</button>}
                {o.status === 'pending' && can('customerOrders.edit') && <button type="button" className="btn-primary" onClick={() => act.mutate({ id: o.id, action: 'accept' })}>Xác nhận</button>}
              </div>
            </div>
          )} />
        <Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="đơn" onChange={(page, pageSize) => set({ page, pageSize })} />
      </div>
    </div>
  );
}
