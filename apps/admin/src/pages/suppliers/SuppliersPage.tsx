import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal, Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import {
  CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter,
  resolveDateRange, useListState, type Column,
} from '../../components/list';
import { SupplierForm, useSupplierGroups, type SupplierDraft } from './SupplierForm';
import { SupplierDetail, type SupplierRow } from './SupplierDetail';
import { PaymentDialog } from './PaymentDialog';
import { ImportFileDialog } from '../../components/ImportFileDialog';

export function SuppliersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useSupplierGroups();
  const { state, set } = useListState({ groupIds: [] as string[], totalFrom: '', totalTo: '', totalDate: 'all', debtFrom: '', debtTo: '', status: 'active' });
  const [form, setForm] = useState<Partial<SupplierDraft> | null>(null);
  const [paying, setPaying] = useState<SupplierRow | null>(null);
  const [adjusting, setAdjusting] = useState<SupplierRow | null>(null);
  const [newDebt, setNewDebt] = useState(0);
  const [adjustNote, setAdjustNote] = useState('');
  const [deleting, setDeleting] = useState<SupplierRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<string | null>(null);

  const totalRange = resolveDateRange(state.totalDate as string);
  const query = {
    page: state.page, pageSize: state.pageSize, search: state.search, sort: state.sort, groupIds: state.groupIds as string[], status: state.status as string,
    totalFrom: state.totalFrom as string, totalTo: state.totalTo as string, totalDateFrom: totalRange.from, totalDateTo: totalRange.to,
    debtFrom: state.debtFrom as string, debtTo: state.debtTo as string,
  };
  const list = useQuery({ queryKey: ['suppliers', query], queryFn: () => api<{ items: SupplierRow[]; total: number; totals: Record<string, number> }>('/suppliers', { query }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['suppliers'] });
  const mutate = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { refresh(); toast('Đã cập nhật'); }, onError: toastError });

  const columns: Column<SupplierRow>[] = [
    { key: 'code', header: 'Mã nhà cung cấp', sortable: true },
    { key: 'name', header: 'Tên nhà cung cấp', sortable: true, render: r => <span className={r.isActive ? '' : 'text-slate-400 line-through'}>{r.name}</span> },
    { key: 'phone', header: 'Điện thoại' },
    { key: 'email', header: 'Email' },
    { key: 'groupName', header: 'Nhóm', hiddenByDefault: true },
    { key: 'debt', header: 'Nợ cần trả hiện tại', money: true, total: true, sortable: true },
    { key: 'totalPurchased', header: 'Tổng mua', money: true, total: true },
  ];
  const range = (fromKey: 'totalFrom' | 'debtFrom', toKey: 'totalTo' | 'debtTo') => (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm"><span className="w-8">Từ</span><input className="input py-1" inputMode="numeric" placeholder="Nhập giá trị" value={state[fromKey] as string} onChange={e => set({ [fromKey]: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="flex items-center gap-2 text-sm"><span className="w-8">Tới</span><input className="input py-1" inputMode="numeric" placeholder="Nhập giá trị" value={state[toKey] as string} onChange={e => set({ [toKey]: e.target.value.replace(/\D/g, '') })} /></label>
    </div>
  );

  return (
    <>
      <ListPage
        sidebar={
          <FilterSidebar title="Nhà cung cấp">
            <FilterSection title="Nhóm nhà cung cấp" action={can('suppliers.create') ? <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setGroupForm('')}>Tạo mới</button> : undefined}>
              <CheckboxFilter options={(groups.data ?? []).map(g => ({ value: String(g.id), label: `${g.name} (${g.supplierCount})` }))} value={state.groupIds as string[]} onChange={v => set({ groupIds: v })} />
              {!groups.data?.length && <p className="text-xs text-slate-400">Chưa có nhóm</p>}
            </FilterSection>
            <FilterSection title="Tổng mua">
              {range('totalFrom', 'totalTo')}
              <div className="pt-1 text-xs text-slate-500">Thời gian</div>
              <DateRangeFilter value={state.totalDate as string} onChange={v => set({ totalDate: v })} presets={['thisMonth', 'lastMonth', 'thisYear', 'all']} />
            </FilterSection>
            <FilterSection title="Nợ hiện tại">{range('debtFrom', 'debtTo')}</FilterSection>
            <FilterSection title="Trạng thái" defaultOpen={false}>
              <RadioFilter options={[{ value: 'active', label: 'Đang hoạt động' }, { value: 'inactive', label: 'Ngừng hoạt động' }, { value: 'all', label: 'Tất cả' }]} value={state.status as string} onChange={v => set({ status: v })} />
            </FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên, số điện thoại"
          onCreate={can('suppliers.create') ? () => setForm({}) : undefined} createLabel="Nhà cung cấp"
          onImport={can('suppliers.create') ? () => setImportOpen(true) : undefined}
          onExport={() => download('/suppliers/export', query, 'nha-cung-cap.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="nhà cung cấp" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="suppliers" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          sort={state.sort} onSortChange={sort => set({ sort })}
          renderExpanded={r => (
            <SupplierDetail s={r} onEdit={() => setForm(r)} onPay={() => setPaying(r)} onAdjust={() => { setNewDebt(r.debt); setAdjusting(r); }}
              onToggle={() => mutate.mutate(() => api(`/suppliers/${r.id}`, { method: 'PUT', body: { ...r, isActive: !r.isActive } }))}
              onDelete={() => setDeleting(r)} />
          )} />
      </ListPage>
      <SupplierForm value={form} onClose={() => setForm(null)} />
      <PaymentDialog supplier={paying} onClose={() => setPaying(null)} />
      <Modal open={!!adjusting} size="sm" title="Điều chỉnh công nợ" onClose={() => setAdjusting(null)}
        footer={<button type="button" className="btn-primary" onClick={() => { const s = adjusting!; setAdjusting(null); mutate.mutate(() => api(`/suppliers/${s.id}/adjust-debt`, { body: { newDebt, note: adjustNote } })); }} disabled={!adjustNote.trim()}>Lưu</button>}>
        <Field label="Nợ cần trả sau điều chỉnh"><MoneyInput value={newDebt} onChange={setNewDebt} /></Field>
        <div className="mt-3"><Field label="Lý do điều chỉnh"><input className="input" value={adjustNote} onChange={e => setAdjustNote(e.target.value)} /></Field></div>
      </Modal>
      <Modal open={groupForm !== null} size="sm" title="Thêm nhóm nhà cung cấp" onClose={() => setGroupForm(null)}
        footer={<button type="button" className="btn-primary" disabled={!groupForm?.trim()} onClick={() => { const name = groupForm!; setGroupForm(null); mutate.mutate(async () => { await api('/supplier-groups', { body: { name } }); await qc.invalidateQueries({ queryKey: ['supplier-groups'] }); }); }}>Lưu</button>}>
        <Field label="Tên nhóm"><input className="input" autoFocus value={groupForm ?? ''} onChange={e => setGroupForm(e.target.value)} /></Field>
      </Modal>
      <ConfirmModal open={!!deleting} title="Xóa nhà cung cấp" danger confirmLabel="Xóa" onClose={() => setDeleting(null)}
        message="Nhà cung cấp đã có giao dịch sẽ chuyển sang ngừng hoạt động thay vì bị xóa."
        onConfirm={() => { const s = deleting!; mutate.mutate(() => api(`/suppliers/${s.id}`, { method: 'DELETE' })); }} />
      <ImportFileDialog open={importOpen} onClose={() => setImportOpen(false)} title="Nhập nhà cung cấp từ file" templatePath="/suppliers/import-template" templateName="mau-nha-cung-cap.xlsx"
        importPath="/suppliers/import" onDone={refresh} />
    </>
  );
}
