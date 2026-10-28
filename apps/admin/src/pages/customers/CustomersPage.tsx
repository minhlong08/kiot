import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal, Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { ImportFileDialog } from '../../components/ImportFileDialog';
import {
  CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter,
  resolveDateRange, useListState, type Column,
} from '../../components/list';
import { CustomerForm, useCustomerGroups, type CustomerDraft } from './CustomerForm';
import { CustomerDetail, type CustomerRow } from './CustomerDetail';
import { customerHistoryTab } from './customerHistory';

type Dialog = { kind: 'pay' | 'debt' | 'points'; c: CustomerRow } | null;

export function CustomersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useCustomerGroups();
  const { state, set } = useListState({ groupIds: [] as string[], created: 'all', birthdayMonth: '', gender: '', type: '', totalFrom: '', totalTo: '', debtFrom: '', debtTo: '', status: 'active' });
  const [form, setForm] = useState<Partial<CustomerDraft> | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [amount, setAmount] = useState(0);
  const [fundId, setFundId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState<CustomerRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const created = resolveDateRange(state.created as string);
  const query = {
    page: state.page, pageSize: state.pageSize, search: state.search, sort: state.sort, groupIds: state.groupIds as string[], status: state.status as string,
    createdFrom: created.from, createdTo: created.to, birthdayMonth: state.birthdayMonth as string, gender: state.gender as string, type: state.type as string,
    totalFrom: state.totalFrom as string, totalTo: state.totalTo as string, debtFrom: state.debtFrom as string, debtTo: state.debtTo as string,
  };
  const list = useQuery({ queryKey: ['customers', query], queryFn: () => api<{ items: CustomerRow[]; total: number; totals: Record<string, number> }>('/customers', { query }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['/customers'] }); };
  const run = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { refresh(); toast('Đã cập nhật'); }, onError: toastError });

  function submitDialog() {
    const d = dialog!;
    setDialog(null);
    if (d.kind === 'pay') run.mutate(() => api(`/customers/${d.c.id}/payments`, { body: { amount, fundId } }));
    if (d.kind === 'debt') run.mutate(() => api(`/customers/${d.c.id}/adjust-debt`, { body: { newDebt: amount, note } }));
    if (d.kind === 'points') run.mutate(() => api(`/customers/${d.c.id}/adjust-points`, { body: { newPoints: amount, note } }));
  }

  const columns: Column<CustomerRow>[] = [
    { key: 'code', header: 'Mã khách hàng', sortable: true },
    { key: 'name', header: 'Tên khách hàng', sortable: true, render: r => <span className={r.isActive ? '' : 'text-slate-400 line-through'}>{r.name}</span> },
    { key: 'phone', header: 'Điện thoại' },
    { key: 'groupName', header: 'Nhóm khách hàng' },
    { key: 'debt', header: 'Nợ hiện tại', money: true, total: true, sortable: true },
    { key: 'points', header: 'Điểm hiện tại', money: true, total: true, sortable: true },
    { key: 'totalSpent', header: 'Tổng bán trừ trả hàng', money: true, total: true, sortable: true },
  ];
  const range = (a: 'totalFrom' | 'debtFrom', b: 'totalTo' | 'debtTo') => (
    <div className="grid grid-cols-2 gap-1">
      <input className="input py-1" inputMode="numeric" placeholder="Từ" value={state[a] as string} onChange={e => set({ [a]: e.target.value.replace(/\D/g, '') })} />
      <input className="input py-1" inputMode="numeric" placeholder="Tới" value={state[b] as string} onChange={e => set({ [b]: e.target.value.replace(/\D/g, '') })} />
    </div>
  );

  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Khách hàng">
            <FilterSection title="Nhóm khách hàng"><CheckboxFilter options={(groups.data ?? []).map(g => ({ value: String(g.id), label: `${g.name} (${g.customerCount})` }))} value={state.groupIds as string[]} onChange={v => set({ groupIds: v })} /></FilterSection>
            <FilterSection title="Ngày tạo" defaultOpen={false}><DateRangeFilter value={state.created as string} onChange={v => set({ created: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
            <FilterSection title="Sinh nhật" defaultOpen={false}>
              <select className="input" aria-label="Tháng sinh" value={state.birthdayMonth as string} onChange={e => set({ birthdayMonth: e.target.value })}>
                <option value="">Tất cả</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Tháng {i + 1}</option>)}
              </select>
            </FilterSection>
            <FilterSection title="Tổng bán" defaultOpen={false}>{range('totalFrom', 'totalTo')}</FilterSection>
            <FilterSection title="Nợ hiện tại" defaultOpen={false}>{range('debtFrom', 'debtTo')}</FilterSection>
            <FilterSection title="Giới tính" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }]} value={state.gender as string} onChange={v => set({ gender: v })} /></FilterSection>
            <FilterSection title="Loại khách" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'person', label: 'Cá nhân' }, { value: 'company', label: 'Công ty' }]} value={state.type as string} onChange={v => set({ type: v })} /></FilterSection>
            <FilterSection title="Trạng thái" defaultOpen={false}><RadioFilter options={[{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }, { value: 'all', label: 'Tất cả' }]} value={state.status as string} onChange={v => set({ status: v })} /></FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên, số điện thoại"
          onCreate={can('customers.create') ? () => setForm({}) : undefined} createLabel="Khách hàng"
          onImport={can('customers.create') ? () => setImportOpen(true) : undefined}
          onExport={() => download('/customers/export', query, 'khach-hang.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="khách hàng" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="customers" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          sort={state.sort} onSortChange={sort => set({ sort })}
          renderExpanded={r => (
            <CustomerDetail c={r} historyTab={customerHistoryTab(r.id)} actions={{
              onEdit: () => setForm({ ...r }),
              onPay: () => { setAmount(Math.max(0, r.debt)); setFundId(null); setDialog({ kind: 'pay', c: r }); },
              onAdjustDebt: () => { setAmount(r.debt); setNote(''); setDialog({ kind: 'debt', c: r }); },
              onAdjustPoints: () => { setAmount(r.points); setNote(''); setDialog({ kind: 'points', c: r }); },
              onToggle: () => run.mutate(() => api(`/customers/${r.id}`, { method: 'PUT', body: { ...r, birthday: r.birthday ? r.birthday.slice(0, 10) : null, isActive: !r.isActive, force: true } })),
              onDelete: () => setDeleting(r),
            }} />
          )} />
      </ListPage>
      <CustomerForm value={form} onClose={() => setForm(null)} />
      <Modal open={!!dialog} size="sm" title={dialog?.kind === 'pay' ? `Thu tiền: ${dialog.c.name}` : dialog?.kind === 'debt' ? 'Điều chỉnh công nợ' : 'Điều chỉnh điểm'} onClose={() => setDialog(null)}
        footer={<button type="button" className="btn-primary" disabled={dialog?.kind !== 'pay' && !note.trim()} onClick={submitDialog}>{dialog?.kind === 'pay' ? 'Tạo phiếu thu' : 'Lưu'}</button>}>
        {dialog?.kind === 'pay' && <div className="space-y-3"><div className="text-sm">Nợ hiện tại: <b>{formatVnd(dialog.c.debt)}</b></div><Field label="Số tiền thu"><MoneyInput value={amount} onChange={setAmount} aria-label="Số tiền thu" /></Field><Field label="Quỹ tiền"><FundSelect value={fundId} onChange={setFundId} /></Field></div>}
        {dialog?.kind === 'debt' && <Field label="Nợ sau điều chỉnh"><MoneyInput value={amount} onChange={setAmount} /></Field>}
        {dialog?.kind === 'points' && <Field label="Điểm sau điều chỉnh"><NumberInput value={amount} onChange={v => setAmount(Math.max(0, Math.round(v)))} /></Field>}
        {dialog && dialog.kind !== 'pay' && <div className="mt-3"><Field label="Lý do điều chỉnh"><input className="input" value={note} onChange={e => setNote(e.target.value)} /></Field></div>}
      </Modal>
      <ConfirmModal open={!!deleting} title="Xóa khách hàng" danger confirmLabel="Xóa" onClose={() => setDeleting(null)}
        message="Khách hàng đã có giao dịch sẽ chuyển sang ngừng hoạt động thay vì bị xóa."
        onConfirm={() => { const c = deleting!; run.mutate(() => api(`/customers/${c.id}`, { method: 'DELETE' })); }} />
      <ImportFileDialog open={importOpen} onClose={() => setImportOpen(false)} title="Nhập khách hàng từ file" templatePath="/customers/import-template" templateName="mau-khach-hang.xlsx" importPath="/customers/import" onDone={refresh} />
    </>
  );
}
