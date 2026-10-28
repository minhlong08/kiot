import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFunds } from '../../lib/cash';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type Sheet = { id: number; code: string; employeeId: number; employee?: { code: string; name: string }; base: number; overtime: number; allowance: number; deduction: number; commission: number; bonus: number; total: number; paid: number; note: string; detail: { lines?: { label: string; amount: number }[]; attendance?: { presentShifts: number; paidLeaveShifts: number; lateCount: number; overtimeMinutes: number } } };
type Period = { id: number; code: string; name: string; from: string; to: string; status: string; statusLabel: string; total: number; paid: number; remaining: number; paysheets: Sheet[] };

export function PayrollPeriodView({ id, onBack }: { id: number; onBack: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const funds = useFunds();
  const q = useQuery({ queryKey: ['payroll-periods', id], queryFn: () => api<Period>(`/payroll-periods/${id}`) });
  const [pay, setPay] = useState<{ sheet: Sheet; amount: number; fundId: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['payroll-periods'] }); qc.invalidateQueries({ queryKey: ['cash-vouchers'] }); };
  const act = useMutation({ mutationFn: (a: 'lock' | 'regenerate' | 'cancel') => api(`/payroll-periods/${id}/${a}`, { body: {} }), onSuccess: (_r, a) => { refresh(); toast(a === 'lock' ? 'Đã chốt bảng lương' : a === 'cancel' ? 'Đã hủy bảng lương' : 'Đã tính lại lương'); if (a === 'cancel') onBack(); }, onError: toastError });
  const bonus = useMutation({ mutationFn: (s: { id: number; bonus: number; note: string }) => api(`/paysheets/${s.id}`, { method: 'PUT', body: { bonus: s.bonus, note: s.note } }), onSuccess: refresh, onError: toastError });
  async function doPay() {
    if (!pay) return;
    try { await api(`/paysheets/${pay.sheet.id}/pay`, { body: { amount: pay.amount, fundId: pay.fundId } }); setPay(null); refresh(); toast('Đã trả lương'); } catch (e) { toastError(e); }
  }
  async function payAll() {
    for (const s of q.data?.paysheets.filter(x => x.total > x.paid) ?? []) {
      try { await api(`/paysheets/${s.id}/pay`, { body: { amount: s.total - s.paid, fundId: null } }); } catch (e) { toastError(e); break; }
    }
    refresh(); toast('Đã thanh toán bảng lương');
  }
  const p = q.data;
  if (!p) return null;
  const draft = p.status === 'draft', locked = p.status === 'locked';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={onBack}><ArrowLeft size={16} />Danh sách</button>
        <h2 className="mr-auto text-lg font-semibold">{p.name} <span className="text-sm font-normal text-slate-500">{p.code} · {p.from} → {p.to} · {p.statusLabel}</span></h2>
        <button type="button" className="btn" onClick={() => download(`/payroll-periods/${id}/export`, {}, `bang-luong-${p.code}.xlsx`)}>Xuất file</button>
        {draft && can('payroll.edit') && <button type="button" className="btn" onClick={() => act.mutate('regenerate')}>Tính lại</button>}
        {draft && can('payroll.edit') && <button type="button" className="btn-primary" onClick={() => act.mutate('lock')}>Chốt lương</button>}
        {locked && can('payroll.edit') && can('cashbook.create') && p.remaining > 0 && <button type="button" className="btn-primary" onClick={payAll}>Thanh toán tất cả</button>}
        {!p.paid && can('payroll.delete') && <button type="button" className="btn text-rose-600" onClick={() => act.mutate('cancel')}>Hủy bảng lương</button>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {([['Tổng lương', p.total], ['Đã trả', p.paid], ['Còn cần trả', p.remaining]] as const).map(([l, v]) => <div key={l} className="card p-3"><div className="text-slate-500">{l}</div><div className="text-lg font-semibold tabular-nums">{formatVnd(v)}</div></div>)}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-2">Nhân viên</th><th className="p-2 text-right">Lương chính</th><th className="p-2 text-right">Làm thêm</th><th className="p-2 text-right">Phụ cấp</th><th className="p-2 text-right">Giảm trừ</th><th className="p-2 text-right">Hoa hồng</th><th className="p-2 text-right">Thưởng</th><th className="p-2 text-right">Tổng</th><th className="p-2 text-right">Đã trả</th><th /></tr></thead>
          <tbody>{p.paysheets.map(s => (
            <Fragment key={s.id}>
              <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <td className="p-2"><div className="font-medium">{s.employee?.name}</div><div className="text-xs text-slate-500">{s.code}</div></td>
                {[s.base, s.overtime, s.allowance, -s.deduction, s.commission].map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{formatVnd(v)}</td>)}
                <td className="p-2 text-right" onClick={e => e.stopPropagation()}>{draft && can('payroll.edit') ? <MoneyInput className="w-28 text-right" value={s.bonus} aria-label={`Thưởng ${s.employee?.name}`} onChange={v => bonus.mutate({ id: s.id, bonus: v, note: s.note })} /> : formatVnd(s.bonus)}</td>
                <td className="p-2 text-right font-semibold tabular-nums">{formatVnd(s.total)}</td><td className="p-2 text-right tabular-nums">{formatVnd(s.paid)}</td>
                <td className="p-2 text-right" onClick={e => e.stopPropagation()}>{locked && s.paid < s.total && can('payroll.edit') && can('cashbook.create') && <button type="button" className="btn" aria-label={`Thanh toán ${s.employee?.name}`} onClick={() => setPay({ sheet: s, amount: s.total - s.paid, fundId: funds.data?.find(f => f.type === 'cash')?.id ?? 0 })}>Thanh toán</button>}</td>
              </tr>
              {open === s.id && <tr className="bg-slate-50/50"><td colSpan={10} className="p-3 text-sm">
                {s.detail.attendance && <p className="mb-1 text-slate-600">Có mặt {s.detail.attendance.presentShifts} ca · nghỉ có phép {s.detail.attendance.paidLeaveShifts} · đi muộn {s.detail.attendance.lateCount} lần · làm thêm {Math.round(s.detail.attendance.overtimeMinutes / 6) / 10} giờ</p>}
                <ul className="grid gap-x-6 sm:grid-cols-3">{s.detail.lines?.map(l => <li key={l.label} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums">{formatVnd(l.amount)}</span></li>)}</ul>
              </td></tr>}
            </Fragment>
          ))}</tbody>
        </table>
      </div>
      <Modal open={!!pay} size="sm" title={`Trả lương ${pay?.sheet.employee?.name ?? ''}`} onClose={() => setPay(null)} footer={<button type="button" className="btn-primary" disabled={!pay?.amount} onClick={doPay}>Trả lương</button>}>
        {pay && <div className="space-y-3">
          <p className="text-sm text-slate-500">Còn cần trả {formatVnd(pay.sheet.total - pay.sheet.paid)}</p>
          <Field label="Số tiền trả"><MoneyInput aria-label="Số tiền trả" value={pay.amount} onChange={amount => setPay({ ...pay, amount })} /></Field>
          <Field label="Quỹ"><select className="input" aria-label="Quỹ" value={pay.fundId} onChange={e => setPay({ ...pay, fundId: Number(e.target.value) })}>{funds.data?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        </div>}
      </Modal>
    </div>
  );
}
