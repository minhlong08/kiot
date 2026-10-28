import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCashCategories } from '../../lib/cash';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, resolveDateRange, useListState, type Column } from '../../components/list';
import { SupplierPicker, type PickedSupplier } from './SupplierPicker';

type Row = { id: number; code: string; createdAt: string; serviceName: string; supplierName: string; categoryName: string; amount: number; paid: number; status: string; note: string };

export function ServicePurchasesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const categories = useCashCategories();
  const { state, set } = useListState({ date: 'thisMonth' });
  const range = resolveDateRange(state.date as string);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, ...range };
  const list = useQuery({ queryKey: ['service-purchases', query], queryFn: () => api<{ items: Row[]; total: number; totals: Record<string, number> }>('/service-purchases', { query }) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ serviceName: '', amount: 0, paid: 0, categoryId: 0, fundId: null as number | null, note: '' });
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['service-purchases'] });
  const create = useMutation({
    mutationFn: () => api('/service-purchases', { body: { ...f, categoryId: f.categoryId || undefined, supplierId: supplier?.id ?? null } }),
    onSuccess: () => { refresh(); setOpen(false); toast('Đã ghi nhận mua dịch vụ'); }, onError: toastError,
  });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/service-purchases/${id}/cancel`, { body: {} }), onSuccess: () => { refresh(); toast('Đã hủy'); }, onError: toastError });
  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã phiếu' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
    { key: 'serviceName', header: 'Dịch vụ' }, { key: 'supplierName', header: 'Nhà cung cấp' }, { key: 'categoryName', header: 'Loại chi' },
    { key: 'amount', header: 'Giá trị', money: true, total: true }, { key: 'paid', header: 'Đã trả', money: true, total: true },
    { key: 'status', header: 'Trạng thái', render: r => <DocStatusBadge status={r.status} /> },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Mua dịch vụ"><FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection></FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã phiếu, tên dịch vụ"
          onCreate={can('servicePurchases.create') ? () => { setF({ serviceName: '', amount: 0, paid: 0, categoryId: 0, fundId: null, note: '' }); setSupplier(null); setOpen(true); } : undefined} createLabel="Mua dịch vụ" />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="service-purchases" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => (
            <div className="flex items-center justify-between p-3 text-sm">
              <span>{r.note}</span>
              {r.status !== 'cancelled' && can('servicePurchases.delete') && <button type="button" className="btn text-rose-600" onClick={() => cancel.mutate(r.id)}>Hủy phiếu</button>}
            </div>
          )} />
      </ListPage>
      <Modal open={open} title="Mua dịch vụ" onClose={() => setOpen(false)}
        footer={<button type="button" className="btn-primary" disabled={!f.serviceName || !f.amount} onClick={() => create.mutate()}>Lưu</button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Tên dịch vụ"><input className="input" placeholder="VD: Thuê vận chuyển" value={f.serviceName} onChange={e => setF({ ...f, serviceName: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><span className="label">Nhà cung cấp (để ghi nợ phần chưa trả)</span><SupplierPicker value={supplier} onChange={setSupplier} /></div>
          <Field label="Loại chi">
            <select className="input" value={f.categoryId} onChange={e => setF({ ...f, categoryId: Number(e.target.value) })}>
              <option value={0}>Chi phí dịch vụ</option>
              {categories.data?.filter(c => c.kind === 'out' && c.name !== 'Chi phí dịch vụ').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Giá trị"><MoneyInput value={f.amount} onChange={amount => setF({ ...f, amount, paid: supplier ? f.paid : amount })} /></Field>
          <Field label="Đã trả"><MoneyInput value={f.paid} onChange={paid => setF({ ...f, paid: Math.min(paid, f.amount) })} /></Field>
          <Field label="Trả từ quỹ"><FundSelect value={f.fundId} onChange={fundId => setF({ ...f, fundId })} /></Field>
          <div className="sm:col-span-2"><Field label="Ghi chú"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </>
  );
}
