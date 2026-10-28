import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { DataTable, type Column } from '../../components/list';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type Branch = { id: number; code: string; name: string; phone: string; address: string; isActive: boolean };
const empty: Omit<Branch, 'id'> = { code: '', name: '', phone: '', address: '', isActive: true };

export function BranchesSettings() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['branches'], queryFn: () => api<{ items: Branch[] }>('/branches', { query: { pageSize: 100 } }) });
  const [editing, setEditing] = useState<(Omit<Branch, 'id'> & { id?: number }) | null>(null);
  const save = useMutation({
    mutationFn: (b: Omit<Branch, 'id'> & { id?: number }) => {
      const { id, ...body } = b;
      return id ? api(`/branches/${id}`, { method: 'PUT', body }) : api('/branches', { body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['me'] }); setEditing(null); toast('Đã lưu chi nhánh'); },
    onError: toastError,
  });
  const columns: Column<Branch>[] = [
    { key: 'code', header: 'Mã' },
    { key: 'name', header: 'Tên chi nhánh' },
    { key: 'phone', header: 'Điện thoại' },
    { key: 'address', header: 'Địa chỉ' },
    { key: 'isActive', header: 'Trạng thái', render: b => (b.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động') },
  ];
  return (
    <div className="space-y-3">
      <button type="button" className="btn-primary" onClick={() => setEditing({ ...empty })}><Plus size={16} />Thêm chi nhánh</button>
      <div className="card overflow-hidden">
        <DataTable tableId="branches" columns={columns} rows={list.data?.items ?? []} getRowId={b => b.id}
          renderExpanded={b => <div className="p-3"><button type="button" className="btn" onClick={() => setEditing(b)}>Chỉnh sửa</button></div>} />
      </div>
      <Modal open={!!editing} title={editing?.id ? 'Sửa chi nhánh' : 'Thêm chi nhánh'} onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Bỏ qua</button><button type="button" className="btn-primary" disabled={save.isPending} onClick={() => editing && save.mutate(editing)}>Lưu</button></>}>
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mã chi nhánh"><input className="input" value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })} /></Field>
            <Field label="Tên chi nhánh"><input className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Điện thoại"><input className="input" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Địa chỉ"><input className="input" value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })} />Đang hoạt động</label>
          </div>
        )}
      </Modal>
    </div>
  );
}
