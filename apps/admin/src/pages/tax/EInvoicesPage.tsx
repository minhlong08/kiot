import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, resolveDateRange, useListState, type Column } from '../../components/list';
import { printEInvoice } from './printEInvoice';

type EInv = { id: number; invoiceId: number; invoiceCode: string; series: string; number: string | null; status: string; statusLabel: string; buyerName: string; buyerTaxCode: string; buyerAddress?: string; buyerEmail?: string; total: number; vatAmount: number; totalBeforeVat: number; createdAt: string; issuedAt?: string | null; lookupCode?: string; cancelReason?: string };
const STATUSES = [{ value: 'draft', label: 'Nháp' }, { value: 'issued', label: 'Đã phát hành' }, { value: 'cancelled', label: 'Đã hủy' }];
const TONE: Record<string, string> = { draft: 'bg-slate-100 text-slate-700', issued: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-rose-50 text-rose-700' };

export function EInvoicesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ date: 'thisMonth', status: ['draft', 'issued', 'cancelled'] as string[] });
  const [create, setCreate] = useState<{ code: string; buyerName: string; buyerTaxCode: string; buyerAddress: string; buyerEmail: string } | null>(null);
  const [cancel, setCancel] = useState<{ id: number; reason: string } | null>(null);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], ...resolveDateRange(state.date as string) };
  const list = useQuery({ queryKey: ['e-invoices', query], queryFn: () => api<{ items: EInv[]; total: number; totals: Record<string, number> }>('/e-invoices', { query }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['e-invoices'] });
  const issue = useMutation({ mutationFn: (id: number) => api<EInv>(`/e-invoices/${id}/issue`, { body: {} }), onSuccess: e => { refresh(); toast(`Đã phát hành số ${e.number}`); }, onError: toastError });
  const remove = useMutation({ mutationFn: (id: number) => api(`/e-invoices/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast('Đã xóa bản nháp'); }, onError: toastError });
  async function saveCreate() {
    if (!create) return;
    try {
      const found = await api<{ items: { id: number; code: string }[] }>('/invoices', { query: { search: create.code.trim(), pageSize: 15, status: ['completed'] } });
      const inv = found.items.find(i => i.code.toUpperCase() === create.code.trim().toUpperCase());
      if (!inv) throw new Error('Không tìm thấy hóa đơn hoàn thành với mã này');
      const { code: _c, ...buyer } = create;
      await api('/e-invoices', { body: { invoiceId: inv.id, ...Object.fromEntries(Object.entries(buyer).filter(([, v]) => v)) } });
      refresh(); setCreate(null); toast('Đã lập hóa đơn điện tử nháp');
    } catch (e) { toastError(e); }
  }
  async function saveCancel() {
    if (!cancel) return;
    try { await api(`/e-invoices/${cancel.id}/cancel`, { body: { reason: cancel.reason } }); refresh(); setCancel(null); toast('Đã hủy hóa đơn điện tử'); } catch (e) { toastError(e); }
  }
  const columns: Column<EInv>[] = [
    { key: 'invoiceCode', header: 'Hóa đơn bán' }, { key: 'number', header: 'Ký hiệu / Số', render: e => (e.number ? `${e.series} - ${e.number}` : <span className="text-slate-400">{e.series} - chưa cấp số</span>) },
    { key: 'createdAt', header: 'Ngày lập', render: e => formatDateTime(e.createdAt) }, { key: 'buyerName', header: 'Người mua' }, { key: 'buyerTaxCode', header: 'MST' },
    { key: 'totalBeforeVat', header: 'Chưa thuế', align: 'right', money: true }, { key: 'vatAmount', header: 'Thuế GTGT', align: 'right', money: true }, { key: 'total', header: 'Tổng tiền', align: 'right', money: true },
    { key: 'status', header: 'Trạng thái', render: e => <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', TONE[e.status])}>{e.statusLabel}</span> },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Hóa đơn điện tử">
          <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear', 'all']} /></FilterSection>
          <FilterSection title="Trạng thái"><CheckboxFilter options={STATUSES} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
        </FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo số, người mua, MST, mã hóa đơn"
          extra={can('tax.create') ? <button type="button" className="btn-primary" onClick={() => setCreate({ code: '', buyerName: '', buyerTaxCode: '', buyerAddress: '', buyerEmail: '' })}><Plus size={16} />Lập HĐĐT</button> : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="hóa đơn" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="e-invoices" columns={columns} rows={list.data?.items ?? []} getRowId={e => e.id} loading={list.isLoading} totals={list.data?.totals}
          renderExpanded={e => (
            <div className="flex flex-wrap items-center gap-2 p-4 text-sm">
              <span className="mr-auto text-slate-600">{e.lookupCode ? `Mã tra cứu: ${e.lookupCode}` : ''}{e.cancelReason ? ` · Lý do hủy: ${e.cancelReason}` : ''}</span>
              <button type="button" className="btn" onClick={() => printEInvoice(e.id).catch(toastError)}>In</button>
              {e.status === 'draft' && can('tax.delete') && <button type="button" className="btn text-rose-600" onClick={() => remove.mutate(e.id)}>Xóa nháp</button>}
              {e.status === 'draft' && (can('tax.edit') || can('tax.create')) && <button type="button" className="btn-primary" disabled={issue.isPending} onClick={() => issue.mutate(e.id)}>Phát hành</button>}
              {e.status === 'issued' && can('tax.delete') && <button type="button" className="btn text-rose-600" onClick={() => setCancel({ id: e.id, reason: '' })}>Hủy hóa đơn</button>}
            </div>
          )} />
      </ListPage>
      <Modal open={!!create} title="Lập hóa đơn điện tử" onClose={() => setCreate(null)} footer={<button type="button" className="btn-primary" disabled={!create?.code} onClick={saveCreate}>Lưu nháp</button>}>
        {create && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mã hóa đơn bán" className="sm:col-span-2"><input className="input" placeholder="HD000123" value={create.code} onChange={e => setCreate({ ...create, code: e.target.value })} /></Field>
          <Field label="Tên người mua / đơn vị" hint="Để trống: lấy theo khách hàng"><input className="input" value={create.buyerName} onChange={e => setCreate({ ...create, buyerName: e.target.value })} /></Field>
          <Field label="Mã số thuế"><input className="input" value={create.buyerTaxCode} onChange={e => setCreate({ ...create, buyerTaxCode: e.target.value })} /></Field>
          <Field label="Địa chỉ"><input className="input" value={create.buyerAddress} onChange={e => setCreate({ ...create, buyerAddress: e.target.value })} /></Field>
          <Field label="Email nhận hóa đơn"><input className="input" value={create.buyerEmail} onChange={e => setCreate({ ...create, buyerEmail: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!cancel} size="sm" title="Hủy hóa đơn điện tử" onClose={() => setCancel(null)} footer={<button type="button" className="btn-primary bg-rose-600" disabled={!cancel?.reason.trim()} onClick={saveCancel}>Hủy hóa đơn</button>}>
        {cancel && <Field label="Lý do hủy"><input className="input" value={cancel.reason} onChange={e => setCancel({ ...cancel, reason: e.target.value })} /></Field>}
      </Modal>
    </>
  );
}
