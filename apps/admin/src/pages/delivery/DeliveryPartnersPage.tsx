import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { DataTable, ListPage, ListToolbar, Pagination, RadioFilter, FilterSection, FilterSidebar, useListState, type Column } from '../../components/list';
import { CodReconcileDialog } from './CodReconcileDialog';
import type { Partner } from './types';

type Draft = Omit<Partner, 'id' | 'code' | 'debt'> & { id?: number };
const empty: Draft = { name: '', phone: '', email: '', address: '', note: '', feeMode: 'flat', flatFee: 0, feePerKg: 0, isActive: true };
type LedgerRow = { id: number; createdAt: string; docCode: string; docType: string; amount: number; balanceAfter: number };
const DOC: Record<string, string> = { deliveryCod: 'Thu hộ COD', deliveryFee: 'Phí giao hàng', codReconciliation: 'Đối soát', deliveryCod_cancel: 'Hủy COD', deliveryFee_cancel: 'Hủy phí', codReconciliation_cancel: 'Hủy đối soát' };

function PartnerLedger({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['delivery-partners', id, 'ledger'], queryFn: () => api<{ items: LedgerRow[] }>(`/delivery-partners/${id}/ledger`, { query: { pageSize: 50 } }) });
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th className="p-2">Thời gian</th><th className="p-2">Chứng từ</th><th className="p-2">Loại</th><th className="p-2 text-right">Giá trị</th><th className="p-2 text-right">Đối tác còn nợ</th></tr></thead>
      <tbody>{q.data?.items.map(r => (
        <tr key={r.id} className="border-t border-slate-100"><td className="p-2">{formatDateTime(r.createdAt)}</td><td className="p-2">{r.docCode}</td><td className="p-2">{DOC[r.docType] ?? r.docType}</td>
          <td className="p-2 text-right tabular-nums">{formatVnd(r.amount)}</td><td className="p-2 text-right tabular-nums">{formatVnd(r.balanceAfter)}</td></tr>
      ))}</tbody>
    </table>
  );
}

export function DeliveryPartnersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ status: 'active' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reconcileFor, setReconcileFor] = useState<number | null>(null);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string };
  const list = useQuery({ queryKey: ['delivery-partners', query], queryFn: () => api<{ items: Partner[]; total: number }>('/delivery-partners', { query }) });
  const save = useMutation({
    mutationFn: ({ id, ...b }: Draft) => api(id ? `/delivery-partners/${id}` : '/delivery-partners', { method: id ? 'PUT' : 'POST', body: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['delivery-partners'] }); setDraft(null); toast('Đã lưu đối tác'); }, onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<{ deactivated?: boolean }>(`/delivery-partners/${id}`, { method: 'DELETE' }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['delivery-partners'] }); toast(r?.deactivated ? 'Đối tác đã có giao dịch nên được ngừng hoạt động' : 'Đã xóa đối tác'); }, onError: toastError,
  });
  const columns: Column<Partner>[] = [
    { key: 'code', header: 'Mã đối tác' }, { key: 'name', header: 'Tên đối tác' }, { key: 'phone', header: 'Điện thoại' },
    { key: 'feeMode', header: 'Cách tính phí', render: p => (p.feeMode === 'flat' ? `Đồng giá ${formatVnd(p.flatFee)}` : `${formatVnd(p.flatFee)} + ${formatVnd(p.feePerKg)}/kg`) },
    { key: 'debt', header: 'Nợ COD cần thu', align: 'right', money: true },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Đối tác giao hàng"><FilterSection title="Trạng thái"><RadioFilter options={[{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }, { value: 'all', label: 'Tất cả' }]} value={state.status as string} onChange={v => set({ status: v })} /></FilterSection></FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên, điện thoại"
          extra={can('deliveries.create') ? <button type="button" className="btn-primary" onClick={() => setDraft(empty)}><Plus size={16} />Đối tác</button> : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="đối tác" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="delivery-partners" columns={columns} rows={list.data?.items ?? []} getRowId={p => p.id} loading={list.isLoading}
          renderExpanded={p => (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="mr-auto text-slate-600">{[p.address, p.email, p.note].filter(Boolean).join(' · ')}</span>
                {can('deliveries.edit') && <button type="button" className="btn" onClick={() => setDraft({ ...p })}>Sửa</button>}
                {can('deliveries.edit') && can('cashbook.create') && p.debt !== 0 && <button type="button" className="btn" onClick={() => setReconcileFor(p.id)}>Đối soát COD</button>}
                {can('deliveries.delete') && <button type="button" className="btn text-rose-600" onClick={() => remove.mutate(p.id)}>Xóa</button>}
              </div>
              <PartnerLedger id={p.id} />
            </div>
          )} />
      </ListPage>
      <Modal open={!!draft} title={draft?.id ? 'Sửa đối tác giao hàng' : 'Thêm đối tác giao hàng'} onClose={() => setDraft(null)}
        footer={<button type="button" className="btn-primary" disabled={!draft?.name || save.isPending} onClick={() => draft && save.mutate(draft)}>Lưu</button>}>
        {draft && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên đối tác"><input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Điện thoại"><input className="input" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></Field>
          <Field label="Địa chỉ"><input className="input" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></Field>
          <Field label="Cách tính phí"><select className="input" value={draft.feeMode} onChange={e => setDraft({ ...draft, feeMode: e.target.value as Draft['feeMode'] })}><option value="flat">Đồng giá</option><option value="byWeight">Theo trọng lượng</option></select></Field>
          <Field label={draft.feeMode === 'flat' ? 'Phí đồng giá' : 'Phí cơ bản'}><MoneyInput value={draft.flatFee} onChange={flatFee => setDraft({ ...draft, flatFee })} /></Field>
          {draft.feeMode === 'byWeight' && <Field label="Phí mỗi kg"><MoneyInput value={draft.feePerKg} onChange={feePerKg => setDraft({ ...draft, feePerKg })} /></Field>}
          <Field label="Ghi chú"><input className="input" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Đang hoạt động</label>
        </div>}
      </Modal>
      <CodReconcileDialog open={reconcileFor !== null} partnerId={reconcileFor ?? undefined} onClose={() => setReconcileFor(null)} />
    </>
  );
}
