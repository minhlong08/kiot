import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { DataTable, type Column } from '../../components/list';
import { useCustomerGroups, type CustomerGroup } from './CustomerForm';

type Draft = { id?: number; name: string; discountPercent: number; minTotalSpent: number | null; note: string };

export function CustomerGroupsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const groups = useCustomerGroups();
  const [d, setD] = useState<Draft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer-groups'] });
  const run = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { refresh(); toast('Đã cập nhật'); setD(null); }, onError: toastError });
  const columns: Column<CustomerGroup>[] = [
    { key: 'name', header: 'Tên nhóm' },
    { key: 'discountPercent', header: 'Giảm giá (%)', align: 'right' },
    { key: 'minTotalSpent', header: 'Tự động khi tổng bán từ', align: 'right', render: g => (g.minTotalSpent === null ? 'Thủ công' : formatVnd(g.minTotalSpent)) },
    { key: 'customerCount', header: 'Số khách hàng', align: 'right' },
    { key: 'note', header: 'Ghi chú' },
  ];
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Nhóm khách hàng</h1>
        <div className="flex gap-2">
          {can('customers.edit') && <button type="button" className="btn" onClick={() => run.mutate(() => api('/customer-groups/apply-auto', { body: {} }))}>Phân nhóm tự động</button>}
          {can('customers.create') && <button type="button" className="btn-primary" onClick={() => setD({ name: '', discountPercent: 0, minTotalSpent: null, note: '' })}><Plus size={16} />Nhóm khách hàng</button>}
        </div>
      </div>
      <div className="card overflow-hidden">
        <DataTable tableId="customer-groups" columns={columns} rows={groups.data ?? []} getRowId={g => g.id}
          renderExpanded={g => (
            <div className="flex justify-end gap-2 p-3">
              {can('customers.delete') && <button type="button" className="btn text-rose-600" onClick={() => run.mutate(() => api(`/customer-groups/${g.id}`, { method: 'DELETE' }))}>Xóa</button>}
              {can('customers.edit') && <button type="button" className="btn-primary" onClick={() => setD({ ...g })}>Chỉnh sửa</button>}
            </div>
          )} />
      </div>
      <Modal open={!!d} size="sm" title={d?.id ? 'Sửa nhóm khách hàng' : 'Thêm nhóm khách hàng'} onClose={() => setD(null)}
        footer={<button type="button" className="btn-primary" disabled={!d?.name} onClick={() => { const { id, ...body } = d!; run.mutate(() => api(id ? `/customer-groups/${id}` : '/customer-groups', { method: id ? 'PUT' : 'POST', body })); }}>Lưu</button>}>
        {d && (
          <div className="space-y-3">
            <Field label="Tên nhóm"><input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Giảm giá mặc định (%)"><NumberInput value={d.discountPercent} onChange={v => setD({ ...d, discountPercent: Math.min(100, Math.max(0, Math.round(v))) })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.minTotalSpent !== null} onChange={e => setD({ ...d, minTotalSpent: e.target.checked ? 0 : null })} />Tự động thêm khách khi tổng bán đạt</label>
            {d.minTotalSpent !== null && <MoneyInput value={d.minTotalSpent} onChange={v => setD({ ...d, minTotalSpent: v })} aria-label="Tổng bán tối thiểu" />}
            <Field label="Ghi chú"><input className="input" value={d.note} onChange={e => setD({ ...d, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
