import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { DataTable, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter, useListState, type Column } from '../../components/list';

type Emp = { id: number; code: string; name: string; phone: string; email: string; branchId: number; branchName: string; position: string; userId: number | null; userName: string | null; birthday: string | null; idNumber: string; address: string; startDate: string | null; salaryTemplateId: number | null; salaryTemplateName: string | null; commissionTableId: number | null; commissionTableName: string | null; note: string; isActive: boolean };
type Draft = Omit<Emp, 'id' | 'code' | 'branchName' | 'userName' | 'salaryTemplateName' | 'commissionTableName'> & { id?: number };
const empty = (branchId: number): Draft => ({ name: '', phone: '', email: '', branchId, position: '', userId: null, birthday: null, idNumber: '', address: '', startDate: null, salaryTemplateId: null, commissionTableId: null, note: '', isActive: true });

export function EmployeesPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ status: 'active' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string };
  const list = useQuery({ queryKey: ['employees', query], queryFn: () => api<{ items: Emp[]; total: number }>('/employees', { query }) });
  const users = useQuery({ queryKey: ['users'], enabled: !!draft, queryFn: () => api<{ items: { id: number; username: string; fullName: string }[] }>('/users', { query: { pageSize: 100 } }).catch(() => ({ items: [] })) });
  const branches = useQuery({ queryKey: ['branches'], enabled: !!draft, queryFn: () => api<{ items: { id: number; name: string }[] }>('/branches', { query: { pageSize: 100 } }) });
  const templates = useQuery({ queryKey: ['salary-templates'], enabled: !!draft, queryFn: () => api<{ id: number; name: string; isActive: boolean }[]>('/salary-templates').catch(() => []) });
  const tables = useQuery({ queryKey: ['commission-tables'], enabled: !!draft, queryFn: () => api<{ id: number; name: string; isActive: boolean }[]>('/commission-tables').catch(() => []) });
  const save = useMutation({
    mutationFn: ({ id, ...b }: Draft) => api(id ? `/employees/${id}` : '/employees', { method: id ? 'PUT' : 'POST', body: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setDraft(null); toast('Đã lưu nhân viên'); }, onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<{ deactivated?: boolean }>(`/employees/${id}`, { method: 'DELETE' }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['employees'] }); toast(r?.deactivated ? 'Nhân viên đã có dữ liệu chấm công nên được chuyển sang nghỉ việc' : 'Đã xóa nhân viên'); }, onError: toastError,
  });
  const columns: Column<Emp>[] = [
    { key: 'code', header: 'Mã nhân viên' }, { key: 'name', header: 'Tên nhân viên' }, { key: 'phone', header: 'Điện thoại' }, { key: 'position', header: 'Chức danh' },
    { key: 'branchName', header: 'Chi nhánh' }, { key: 'userName', header: 'Tài khoản đăng nhập', render: e => e.userName ?? '—' }, { key: 'salaryTemplateName', header: 'Mẫu lương', hiddenByDefault: true },
    { key: 'isActive', header: 'Trạng thái', render: e => (e.isActive ? 'Đang làm việc' : 'Đã nghỉ') },
  ];
  const branchId = me?.user.branchId ?? 0;
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Nhân viên"><FilterSection title="Trạng thái"><RadioFilter options={[{ value: 'active', label: 'Đang làm việc' }, { value: 'inactive', label: 'Đã nghỉ' }, { value: 'all', label: 'Tất cả' }]} value={state.status as string} onChange={v => set({ status: v })} /></FilterSection></FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên, điện thoại" onExport={() => download('/employees/export', query, 'nhan-vien.xlsx')}
          extra={can('employees.create') ? <button type="button" className="btn-primary" onClick={() => setDraft(empty(branchId))}><Plus size={16} />Nhân viên</button> : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="nhân viên" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="employees" columns={columns} rows={list.data?.items ?? []} getRowId={e => e.id} loading={list.isLoading}
          renderExpanded={e => (
            <div className="space-y-2 p-4 text-sm">
              <div className="grid gap-x-6 gap-y-1 md:grid-cols-3">
                <div><span className="text-slate-500">Ngày sinh: </span>{e.birthday ?? '—'}</div><div><span className="text-slate-500">Ngày vào làm: </span>{e.startDate ?? '—'}</div><div><span className="text-slate-500">CCCD: </span>{e.idNumber || '—'}</div>
                <div><span className="text-slate-500">Email: </span>{e.email || '—'}</div><div><span className="text-slate-500">Mẫu lương: </span>{e.salaryTemplateName ?? '—'}</div><div><span className="text-slate-500">Hoa hồng: </span>{e.commissionTableName ?? '—'}</div>
                <div className="md:col-span-3"><span className="text-slate-500">Địa chỉ: </span>{e.address || '—'}</div>
              </div>
              <div className="flex justify-end gap-2">
                {can('employees.edit') && <button type="button" className="btn" onClick={() => setDraft({ ...e })}>Sửa</button>}
                {can('employees.delete') && e.isActive && <button type="button" className="btn text-rose-600" onClick={() => remove.mutate(e.id)}>Xóa</button>}
              </div>
            </div>
          )} />
      </ListPage>
      <Modal open={!!draft} size="lg" title={draft?.id ? 'Sửa nhân viên' : 'Thêm nhân viên'} onClose={() => setDraft(null)}
        footer={<button type="button" className="btn-primary" disabled={!draft?.name || save.isPending} onClick={() => draft && save.mutate(draft)}>Lưu</button>}>
        {draft && <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tên nhân viên"><input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Điện thoại"><input className="input" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></Field>
          <Field label="Chức danh"><input className="input" value={draft.position} onChange={e => setDraft({ ...draft, position: e.target.value })} /></Field>
          <Field label="Chi nhánh làm việc"><select className="input" value={draft.branchId} onChange={e => setDraft({ ...draft, branchId: Number(e.target.value) })}>{branches.data?.items.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Tài khoản đăng nhập"><select className="input" value={draft.userId ?? ''} onChange={e => setDraft({ ...draft, userId: e.target.value ? Number(e.target.value) : null })}><option value="">Không gắn</option>{users.data?.items.map(u => <option key={u.id} value={u.id}>{u.username} — {u.fullName}</option>)}</select></Field>
          <Field label="Email"><input className="input" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></Field>
          <Field label="Ngày sinh"><input type="date" className="input" value={draft.birthday ?? ''} onChange={e => setDraft({ ...draft, birthday: e.target.value || null })} /></Field>
          <Field label="Ngày vào làm"><input type="date" className="input" value={draft.startDate ?? ''} onChange={e => setDraft({ ...draft, startDate: e.target.value || null })} /></Field>
          <Field label="Số CCCD"><input className="input" value={draft.idNumber} onChange={e => setDraft({ ...draft, idNumber: e.target.value })} /></Field>
          <Field label="Mẫu lương"><select className="input" value={draft.salaryTemplateId ?? ''} onChange={e => setDraft({ ...draft, salaryTemplateId: e.target.value ? Number(e.target.value) : null })}><option value="">Chưa áp dụng</option>{templates.data?.filter(x => x.isActive || x.id === draft.salaryTemplateId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Bảng hoa hồng"><select className="input" value={draft.commissionTableId ?? ''} onChange={e => setDraft({ ...draft, commissionTableId: e.target.value ? Number(e.target.value) : null })}><option value="">Không</option>{tables.data?.filter(x => x.isActive || x.id === draft.commissionTableId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Đang làm việc</label>
          <Field label="Địa chỉ" className="sm:col-span-2"><input className="input" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></Field>
          <Field label="Ghi chú"><input className="input" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
        </div>}
      </Modal>
    </>
  );
}
