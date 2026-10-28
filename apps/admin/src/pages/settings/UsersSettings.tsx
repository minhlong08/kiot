import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { DataTable, type Column } from '../../components/list';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type User = { id: number; username: string; fullName: string; phone: string | null; email: string | null; isActive: boolean; roleId: number; roleName: string; branchIds: number[] };
type Draft = { id?: number; username: string; fullName: string; phone: string; email: string; password: string; roleId: number; branchIds: number[]; isActive: boolean };

export function UsersSettings() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: User[] }>('/users', { query: { pageSize: 100 } }) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ items: { id: number; name: string }[] }>('/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ items: { id: number; name: string }[] }>('/branches', { query: { pageSize: 100 } }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, password, ...rest } = d;
      return id ? api(`/users/${id}`, { method: 'PUT', body: rest }) : api('/users', { body: { ...rest, password } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setDraft(null); toast('Đã lưu người dùng'); },
    onError: toastError,
  });
  const reset = useMutation({
    mutationFn: () => api(`/users/${resetFor!.id}/reset-password`, { body: { newPassword } }),
    onSuccess: () => { setResetFor(null); setNewPassword(''); toast('Đã đặt lại mật khẩu'); },
    onError: toastError,
  });

  const columns: Column<User>[] = [
    { key: 'username', header: 'Tên đăng nhập' },
    { key: 'fullName', header: 'Họ tên' },
    { key: 'phone', header: 'Điện thoại' },
    { key: 'roleName', header: 'Vai trò' },
    { key: 'isActive', header: 'Trạng thái', render: u => (u.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động') },
  ];
  const fresh = (): Draft => ({ username: '', fullName: '', phone: '', email: '', password: '', roleId: roles.data?.items[1]?.id ?? roles.data?.items[0]?.id ?? 0, branchIds: branches.data?.items.slice(0, 1).map(b => b.id) ?? [], isActive: true });

  return (
    <div className="space-y-3">
      <button type="button" className="btn-primary" onClick={() => setDraft(fresh())}><Plus size={16} />Thêm người dùng</button>
      <div className="card overflow-hidden">
        <DataTable tableId="users" columns={columns} rows={users.data?.items ?? []} getRowId={u => u.id}
          renderExpanded={u => (
            <div className="flex gap-2 p-3">
              <button type="button" className="btn" onClick={() => setDraft({ ...u, phone: u.phone ?? '', email: u.email ?? '', password: '' })}>Chỉnh sửa</button>
              <button type="button" className="btn" onClick={() => setResetFor(u)}>Đặt lại mật khẩu</button>
            </div>
          )} />
      </div>
      <Modal open={!!draft} title={draft?.id ? 'Sửa người dùng' : 'Thêm người dùng'} onClose={() => setDraft(null)}
        footer={<><button type="button" className="btn" onClick={() => setDraft(null)}>Bỏ qua</button><button type="button" className="btn-primary" disabled={save.isPending} onClick={() => draft && save.mutate(draft)}>Lưu</button></>}>
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên đăng nhập"><input className="input" value={draft.username} disabled={!!draft.id} onChange={e => setDraft({ ...draft, username: e.target.value })} /></Field>
            <Field label="Họ tên"><input className="input" value={draft.fullName} onChange={e => setDraft({ ...draft, fullName: e.target.value })} /></Field>
            <Field label="Điện thoại"><input className="input" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></Field>
            {!draft.id && <Field label="Mật khẩu (người dùng sẽ phải đổi khi đăng nhập)"><input type="password" className="input" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} /></Field>}
            <Field label="Vai trò">
              <select className="input" value={draft.roleId} onChange={e => setDraft({ ...draft, roleId: Number(e.target.value) })}>
                {roles.data?.items.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <span className="label">Chi nhánh được truy cập</span>
              <div className="flex flex-wrap gap-3">
                {branches.data?.items.map(b => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.branchIds.includes(b.id)}
                      onChange={() => setDraft({ ...draft, branchIds: draft.branchIds.includes(b.id) ? draft.branchIds.filter(x => x !== b.id) : [...draft.branchIds, b.id] })} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Đang hoạt động</label>
          </div>
        )}
      </Modal>
      <Modal open={!!resetFor} size="sm" title={`Đặt lại mật khẩu: ${resetFor?.fullName ?? ''}`} onClose={() => setResetFor(null)}
        footer={<button type="button" className="btn-primary" disabled={newPassword.length < 6} onClick={() => reset.mutate()}>Lưu</button>}>
        <Field label="Mật khẩu mới (tối thiểu 6 ký tự)"><input type="password" className="input" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
