import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { PROVINCES, formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BulkBar, CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter, resolveDateRange, useListState, type Column } from '../../components/list';
import { DeliveryEditForm } from './DeliveryEditForm';
import { StatusDialog } from './StatusDialog';
import { usePartners } from './usePartners';
import { DELIVERY_STATUSES, STATUS_TONE, type DeliveryList, type DeliveryRow } from './types';

export const StatusBadge = ({ status, label }: { status: string; label: string }) => <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{label}</span>;

export function WaybillsPage() {
  const { can } = useAuth();
  const partners = usePartners('all');
  const { state, set } = useListState({ date: 'thisMonth', status: [] as string[], partnerIds: [] as string[], province: '', reconciled: '' });
  const [selected, setSelected] = useState<number[]>([]);
  const [statusIds, setStatusIds] = useState<number[]>([]);
  const query = {
    page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], partnerIds: state.partnerIds as string[],
    province: (state.province as string) || undefined, reconciled: (state.reconciled as string) || undefined, ...resolveDateRange(state.date as string),
  };
  const list = useQuery({ queryKey: ['deliveries', query], queryFn: () => api<DeliveryList>('/deliveries', { query }) });
  const columns: Column<DeliveryRow>[] = [
    { key: 'invoiceCode', header: 'Mã vận đơn' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
    { key: 'receiverName', header: 'Người nhận', render: r => <><div>{r.receiverName}</div><div className="text-xs text-slate-500">{r.customerName}</div></> },
    { key: 'receiverPhone', header: 'Điện thoại' }, { key: 'address', header: 'Địa chỉ', render: r => [r.address, r.ward, r.province].filter(Boolean).join(', ') },
    { key: 'partnerName', header: 'Đối tác' }, { key: 'fee', header: 'Phí giao', align: 'right', money: true }, { key: 'cod', header: 'COD', align: 'right', money: true },
    { key: 'status', header: 'Trạng thái', render: r => <StatusBadge status={r.status} label={r.statusLabel} /> },
    { key: 'reconciledAt', header: 'Đối soát', hiddenByDefault: true, render: r => (r.reconciledAt ? 'Đã đối soát' : '') },
  ];
  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Vận đơn">
            <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
            <FilterSection title="Trạng thái giao hàng"><CheckboxFilter options={DELIVERY_STATUSES} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
            <FilterSection title="Đối tác giao hàng"><CheckboxFilter options={(partners.data?.items ?? []).map(p => ({ value: String(p.id), label: p.name }))} value={state.partnerIds as string[]} onChange={v => set({ partnerIds: v })} /></FilterSection>
            <FilterSection title="Đối soát COD" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'false', label: 'Chưa đối soát' }, { value: 'true', label: 'Đã đối soát' }]} value={state.reconciled as string} onChange={v => set({ reconciled: v })} /></FilterSection>
            <FilterSection title="Tỉnh/Thành" defaultOpen={false}><select className="input" value={state.province as string} onChange={e => set({ province: e.target.value })}><option value="">Tất cả</option>{PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}</select></FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã vận đơn, người nhận, điện thoại" onExport={() => download('/deliveries/export', query, 'van-don.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="vận đơn" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <BulkBar count={selected.length} onClear={() => setSelected([])} actions={can('deliveries.edit') ? [{ label: 'Cập nhật trạng thái', onClick: () => setStatusIds(selected) }] : []} />
        <DataTable tableId="waybills" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.invoiceId} loading={list.isLoading}
          totals={list.data ? { fee: list.data.totals.fee, cod: list.data.totals.cod } : undefined}
          selected={selected} onSelectedChange={ids => setSelected(ids as number[])}
          renderExpanded={r => (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <StatusBadge status={r.status} label={r.statusLabel} />
                <span>Hóa đơn <Link to="/invoices" search={{ search: r.invoiceCode }} className="text-brand-700 hover:underline">{r.invoiceCode}</Link> · {formatVnd(r.invoiceTotal)}</span>
                {r.reconciledAt && <span className="text-emerald-700">Đã đối soát {formatDateTime(r.reconciledAt)}</span>}
                {can('deliveries.edit') && !['delivered', 'returned', 'cancelled'].includes(r.status) && <button type="button" className="btn ml-auto" onClick={() => setStatusIds([r.invoiceId])}>Cập nhật trạng thái</button>}
              </div>
              <DeliveryEditForm row={r} />
            </div>
          )} />
      </ListPage>
      <StatusDialog ids={statusIds} onClose={done => { setStatusIds([]); if (done) setSelected([]); }} />
    </>
  );
}
