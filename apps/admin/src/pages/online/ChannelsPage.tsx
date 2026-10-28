import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type Channel = { id: number; code: string; name: string; isActive: boolean };
type Draft = { id?: number; code: string; name: string; isActive: boolean };

/** Sales channels tag orders and invoices; marketplace connections would plug in behind each code. */
export function ChannelsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['sales-channels'], queryFn: () => api<Channel[]>('/sales-channels') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useMutation({
    mutationFn: ({ id, code, ...b }: Draft) => api(id ? `/sales-channels/${id}` : '/sales-channels', { method: id ? 'PUT' : 'POST', body: id ? b : { code, ...b } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-channels'] }); setDraft(null); toast('Đã lưu kênh bán'); }, onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<{ deactivated?: boolean }>(`/sales-channels/${id}`, { method: 'DELETE' }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['sales-channels'] }); toast(r?.deactivated ? 'Kênh đã có đơn hàng nên được ngừng hoạt động' : 'Đã xóa kênh'); }, onError: toastError,
  });
  return (
    <div className="max-w-3xl p-4">
      <div className="mb-4 flex items-center"><h1 className="mr-auto text-xl font-bold">Kênh bán hàng</h1>{can('online.create') && <button type="button" className="btn-primary" onClick={() => setDraft({ code: '', name: '', isActive: true })}><Plus size={16} />Kênh bán</button>}</div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Mã</th><th className="p-3">Tên kênh</th><th className="p-3">Kết nối</th><th className="p-3">Trạng thái</th><th /></tr></thead>
          <tbody>{list.data?.map(c => (
            <tr key={c.id} className="border-t border-slate-100">
              <td className="p-3 font-mono text-xs">{c.code}</td><td className="p-3 font-medium">{c.name}</td>
              <td className="p-3 text-slate-500">{c.code === 'store' ? 'Bán tại quầy' : c.code === 'website' ? 'Website của cửa hàng' : 'Nhập đơn thủ công'}</td>
              <td className="p-3">{c.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
              <td className="whitespace-nowrap p-3 text-right">
                {can('online.edit') && <button type="button" className="btn-ghost" onClick={() => setDraft(c)}>Sửa</button>}
                {can('online.delete') && !['store', 'website'].includes(c.code) && <button type="button" className="btn-ghost text-rose-600" onClick={() => remove.mutate(c.id)}>Xóa</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Modal open={!!draft} size="sm" title={draft?.id ? 'Sửa kênh bán' : 'Thêm kênh bán'} onClose={() => setDraft(null)} footer={<button type="button" className="btn-primary" disabled={!draft?.name || !draft.code} onClick={() => draft && save.mutate(draft)}>Lưu</button>}>
        {draft && <div className="space-y-3">
          <Field label="Mã kênh" hint="Chữ thường, số và dấu -, ví dụ tiktok"><input className="input" disabled={!!draft.id} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toLowerCase() })} /></Field>
          <Field label="Tên kênh"><input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Đang hoạt động</label>
        </div>}
      </Modal>
    </div>
  );
}
