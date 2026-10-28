import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { CommissionTableForm, type CommissionTable } from './CommissionTableForm';

const ruleText = (r: CommissionTable['rules'][number]) => `${r.scope === 'all' ? 'Tất cả' : r.scope === 'group' ? 'Nhóm' : 'Hàng'}: ${r.type === 'percent' ? `${r.value}%` : `${formatVnd(r.value)}/sp`}`;

export function CommissionsPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['commission-tables'], queryFn: () => api<CommissionTable[]>('/commission-tables') });
  const [edit, setEdit] = useState<CommissionTable | null | 'new'>(null);
  return (
    <div className="max-w-4xl space-y-3 p-4">
      <div className="flex items-center"><h1 className="mr-auto text-xl font-bold">Bảng hoa hồng</h1>{can('payroll.create') && <button type="button" className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Bảng hoa hồng</button>}</div>
      <p className="text-sm text-slate-500">Hoa hồng tính trên doanh thu thuần (trừ hàng trả lại) của các hóa đơn mà nhân viên là người bán, trong kỳ lương. Gán bảng hoa hồng cho nhân viên trong hồ sơ nhân viên.</p>
      <div className="card overflow-hidden"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Tên bảng</th><th className="p-3">Quy tắc</th><th className="p-3">Trạng thái</th><th /></tr></thead>
        <tbody>{list.data?.map(t => (
          <tr key={t.id} className="border-t border-slate-100"><td className="p-3 font-medium">{t.name}</td><td className="p-3 text-slate-600">{t.rules.map(ruleText).join(' · ') || '—'}</td><td className="p-3">{t.isActive ? 'Đang áp dụng' : 'Ngừng'}</td>
            <td className="p-3 text-right">{can('payroll.edit') && <button type="button" className="btn-ghost" onClick={() => setEdit(t)}>Sửa</button>}</td></tr>
        ))}</tbody>
      </table></div>
      {edit && <CommissionTableForm table={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
