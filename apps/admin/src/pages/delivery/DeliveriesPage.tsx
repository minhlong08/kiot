import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ConfirmModal } from '../../components/Modal';
import { toast, toastError } from '../../components/toast';
import { DataTable, Pagination, useListState, type Column } from '../../components/list';
import { CodReconcileDialog } from './CodReconcileDialog';
import { StatusDialog } from './StatusDialog';
import { StatusBadge } from './WaybillsPage';
import { DELIVERY_STATUSES, type DeliveryList, type DeliveryRow } from './types';

type Rec = { id: number; code: string; createdAt: string; partnerName: string; waybillCount: number; codTotal: number; feeTotal: number; amount: number; status: string; note: string };
const TABS = [...DELIVERY_STATUSES.filter(s => s.value !== 'cancelled'), { value: 'reconciliations', label: 'Phiếu đối soát' }];

/** Delivery board: waybills by status with quick moves, plus COD reconciliation with carriers. */
export function DeliveriesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ tab: 'delivering' });
  const [selected, setSelected] = useState<number[]>([]);
  const [statusIds, setStatusIds] = useState<number[]>([]);
  const [reconcile, setReconcile] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const isRec = state.tab === 'reconciliations';
  const query = { page: state.page, pageSize: state.pageSize, status: [state.tab as string] };
  const list = useQuery({ queryKey: ['deliveries', 'board', query], enabled: !isRec, queryFn: () => api<DeliveryList>('/deliveries', { query }) });
  const counts = useQuery({ queryKey: ['deliveries', 'counts'], queryFn: () => api<DeliveryList>('/deliveries', { query: { pageSize: 15 } }) });
  const recs = useQuery({ queryKey: ['cod-reconciliations', state.page], enabled: isRec, queryFn: () => api<{ items: Rec[]; total: number }>('/cod-reconciliations', { query: { page: state.page, pageSize: state.pageSize } }) });
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/cod-reconciliations/${id}/cancel`, { body: {} }),
    onSuccess: () => { ['cod-reconciliations', 'deliveries', 'cash-vouchers'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); toast('Đã hủy phiếu đối soát'); },
    onError: toastError,
  });
  const columns: Column<DeliveryRow>[] = [
    { key: 'invoiceCode', header: 'Mã vận đơn' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
    { key: 'receiverName', header: 'Người nhận' }, { key: 'receiverPhone', header: 'Điện thoại' }, { key: 'partnerName', header: 'Đối tác' },
    { key: 'cod', header: 'COD', align: 'right', money: true }, { key: 'status', header: 'Trạng thái', render: r => <StatusBadge status={r.status} label={r.statusLabel} /> },
  ];
  const recColumns: Column<Rec>[] = [
    { key: 'code', header: 'Mã phiếu' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) }, { key: 'partnerName', header: 'Đối tác' },
    { key: 'waybillCount', header: 'Số vận đơn', align: 'right' }, { key: 'codTotal', header: 'Tổng COD', align: 'right', money: true }, { key: 'feeTotal', header: 'Phí', align: 'right', money: true },
    { key: 'amount', header: 'Thực nhận', align: 'right', render: r => <span className={clsx('tabular-nums', r.status === 'cancelled' && 'text-slate-400 line-through')}>{formatVnd(r.amount)}</span> },
  ];
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Quản lý giao hàng</h1>
        {can('deliveries.edit') && can('cashbook.create') && <button type="button" className="btn-primary" onClick={() => setReconcile(true)}>Đối soát COD</button>}
      </div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.value} type="button" onClick={() => { set({ tab: t.value, page: 1 }); setSelected([]); }}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', state.tab === t.value ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500')}>
            {t.label}{t.value !== 'reconciliations' && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs">{counts.data?.statusCounts[t.value] ?? 0}</span>}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        {isRec ? (
          <>
            <DataTable tableId="cod-reconciliations" columns={recColumns} rows={recs.data?.items ?? []} getRowId={r => r.id} loading={recs.isLoading}
              renderExpanded={r => (
                <div className="flex items-center gap-3 p-4 text-sm">
                  {r.note && <span>Ghi chú: {r.note}</span>}
                  {r.status !== 'cancelled' && can('deliveries.edit') && <button type="button" className="btn ml-auto text-rose-600" onClick={() => setCancelId(r.id)}>Hủy phiếu</button>}
                </div>
              )} />
            <Pagination page={state.page} pageSize={state.pageSize} total={recs.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />
          </>
        ) : (
          <>
            {selected.length > 0 && <div className="flex items-center gap-2 border-b border-slate-100 bg-brand-50 px-3 py-2 text-sm">Đã chọn {selected.length}<button type="button" className="btn ml-2" onClick={() => setStatusIds(selected)}>Cập nhật trạng thái</button></div>}
            <DataTable tableId="delivery-board" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.invoiceId} loading={list.isLoading}
              selected={can('deliveries.edit') ? selected : undefined} onSelectedChange={can('deliveries.edit') ? ids => setSelected(ids as number[]) : undefined} />
            <Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="vận đơn" onChange={(page, pageSize) => set({ page, pageSize })} />
          </>
        )}
      </div>
      <StatusDialog ids={statusIds} onClose={done => { setStatusIds([]); if (done) setSelected([]); }} />
      <CodReconcileDialog open={reconcile} onClose={() => setReconcile(false)} />
      <ConfirmModal open={cancelId !== null} danger title="Hủy phiếu đối soát" confirmLabel="Hủy phiếu" onClose={() => setCancelId(null)}
        message="Phiếu thu tương ứng bị hủy, công nợ đối tác và các vận đơn trở lại trạng thái chưa đối soát." onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </div>
  );
}
