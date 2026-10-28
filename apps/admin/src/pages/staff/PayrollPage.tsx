import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { Pagination, useListState } from '../../components/list';
import { PayrollPeriodView } from './PayrollPeriodView';
import { SalaryTemplates } from './SalaryTemplates';

type Period = { id: number; code: string; name: string; from: string; to: string; status: string; statusLabel: string; total: number; paid: number; remaining: number; employeeCount: number };
const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }; };

export function PayrollPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ tab: 'periods', open: '' });
  const [create, setCreate] = useState<{ month: string; name: string } | null>(null);
  const list = useQuery({ queryKey: ['payroll-periods', state.page, state.pageSize], enabled: state.tab === 'periods' && !state.open, queryFn: () => api<{ items: Period[]; total: number }>('/payroll-periods', { query: { page: state.page, pageSize: state.pageSize } }) });
  async function save() {
    if (!create) return;
    try {
      const p = await api<{ id: number }>('/payroll-periods', { body: { name: create.name, ...monthRange(create.month) } });
      await qc.invalidateQueries({ queryKey: ['payroll-periods'] }); setCreate(null); toast('Đã tạo bảng lương'); set({ open: String(p.id) });
    } catch (e) { toastError(e); }
  }
  const thisMonth = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Bảng lương</h1>
        {state.tab === 'periods' && !state.open && can('payroll.create') && <button type="button" className="btn-primary" onClick={() => setCreate({ month: thisMonth, name: `Bảng lương tháng ${thisMonth.slice(5)}/${thisMonth.slice(0, 4)}` })}><Plus size={16} />Bảng lương</button>}
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {[['periods', 'Bảng lương'], ['templates', 'Mẫu lương']].map(([k, l]) => <button key={k} type="button" onClick={() => set({ tab: k, open: '' })} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', state.tab === k ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500')}>{l}</button>)}
      </div>
      {state.tab === 'templates' && <SalaryTemplates />}
      {state.tab === 'periods' && state.open && <PayrollPeriodView id={Number(state.open)} onBack={() => set({ open: '' })} />}
      {state.tab === 'periods' && !state.open && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Mã</th><th className="p-3">Tên</th><th className="p-3">Kỳ làm việc</th><th className="p-3 text-right">Số NV</th><th className="p-3 text-right">Tổng lương</th><th className="p-3 text-right">Đã trả</th><th className="p-3 text-right">Còn cần trả</th><th className="p-3">Trạng thái</th></tr></thead>
            <tbody>{list.data?.items.map(p => (
              <tr key={p.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => set({ open: String(p.id) })}>
                <td className="p-3">{p.code}</td><td className="p-3 font-medium">{p.name}</td><td className="p-3">{p.from} → {p.to}</td><td className="p-3 text-right">{p.employeeCount}</td>
                <td className="p-3 text-right tabular-nums">{formatVnd(p.total)}</td><td className="p-3 text-right tabular-nums">{formatVnd(p.paid)}</td><td className="p-3 text-right tabular-nums">{formatVnd(p.remaining)}</td><td className="p-3">{p.statusLabel}</td>
              </tr>
            ))}
            {list.data && !list.data.items.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Chưa có bảng lương</td></tr>}</tbody>
          </table>
          <Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="bảng lương" onChange={(page, pageSize) => set({ page, pageSize })} />
        </div>
      )}
      <Modal open={!!create} size="sm" title="Tạo bảng lương" onClose={() => setCreate(null)} footer={<button type="button" className="btn-primary" disabled={!create?.name} onClick={save}>Tạo</button>}>
        {create && <div className="space-y-3">
          <Field label="Tháng"><input type="month" className="input" aria-label="Tháng" value={create.month} onChange={e => setCreate({ month: e.target.value, name: `Bảng lương tháng ${e.target.value.slice(5)}/${e.target.value.slice(0, 4)}` })} /></Field>
          <Field label="Tên bảng lương"><input className="input" value={create.name} onChange={e => setCreate({ ...create, name: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">Lương được tính từ bảng chấm công, mẫu lương và hoa hồng của nhân viên trong tháng. Có thể tính lại cho đến khi chốt.</p>
        </div>}
      </Modal>
    </div>
  );
}
