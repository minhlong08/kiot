import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { formatVnd, type SalaryTemplateInput } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

type Tpl = SalaryTemplateInput & { id: number };
const MODE = { monthly: 'Theo tháng (ngày công chuẩn)', perShift: 'Theo ca', perHour: 'Theo giờ' } as const;
const empty: SalaryTemplateInput = { name: '', mode: 'monthly', amount: 0, overtimeRate: 150, allowances: [], deductions: [], isActive: true };

export function SalaryTemplates() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['salary-templates'], queryFn: () => api<Tpl[]>('/salary-templates') });
  const [d, setD] = useState<(SalaryTemplateInput & { id?: number }) | null>(null);
  async function save() {
    if (!d) return;
    try {
      const { id, ...body } = d;
      await api(id ? `/salary-templates/${id}` : '/salary-templates', { method: id ? 'PUT' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['salary-templates'] }); setD(null); toast('Đã lưu mẫu lương');
    } catch (e) { toastError(e); }
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{can('payroll.create') && <button type="button" className="btn-primary" onClick={() => setD(empty)}><Plus size={16} />Mẫu lương</button>}</div>
      <div className="card overflow-hidden"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Tên mẫu</th><th className="p-3">Hình thức</th><th className="p-3 text-right">Mức lương</th><th className="p-3">Phụ cấp / giảm trừ</th><th /></tr></thead>
        <tbody>{list.data?.map(t => (
          <tr key={t.id} className="border-t border-slate-100"><td className="p-3 font-medium">{t.name}{!t.isActive && <span className="ml-2 text-xs text-slate-400">(ngừng dùng)</span>}</td><td className="p-3">{MODE[t.mode]}</td><td className="p-3 text-right tabular-nums">{formatVnd(t.amount)}</td>
            <td className="p-3 text-slate-600">{[...t.allowances.map(a => `+${a.name}`), ...t.deductions.map(x => `−${x.name}`)].join(', ') || '—'}</td>
            <td className="p-3 text-right">{can('payroll.edit') && <button type="button" className="btn-ghost" onClick={() => setD(t)}>Sửa</button>}</td></tr>
        ))}</tbody>
      </table></div>
      <Modal open={!!d} size="lg" title={d?.id ? 'Sửa mẫu lương' : 'Thêm mẫu lương'} onClose={() => setD(null)} footer={<button type="button" className="btn-primary" disabled={!d?.name || !d.amount} onClick={save}>Lưu</button>}>
        {d && <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Tên mẫu" className="sm:col-span-2"><input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
            <Field label="Hình thức"><select className="input" value={d.mode} onChange={e => setD({ ...d, mode: e.target.value as Tpl['mode'] })}>{Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label={d.mode === 'monthly' ? 'Lương tháng' : d.mode === 'perShift' ? 'Lương mỗi ca' : 'Lương mỗi giờ'}><MoneyInput value={d.amount} onChange={amount => setD({ ...d, amount })} /></Field>
            <Field label="Hệ số làm thêm (%)"><NumberInput value={d.overtimeRate} onChange={overtimeRate => setD({ ...d, overtimeRate })} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={d.isActive} onChange={e => setD({ ...d, isActive: e.target.checked })} />Đang dùng</label>
          </div>
          {(['allowances', 'deductions'] as const).map(kind => (
            <div key={kind}>
              <div className="mb-1 flex items-center"><h3 className="mr-auto text-sm font-medium">{kind === 'allowances' ? 'Phụ cấp' : 'Giảm trừ'}</h3>
                <button type="button" className="btn-ghost text-sm" onClick={() => setD({ ...d, [kind]: [...d[kind], { name: '', amount: 0, per: 'month' }] })}><Plus size={14} />Thêm</button></div>
              {d[kind].map((x, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_140px_160px_auto] gap-2">
                  <input className="input" placeholder="Tên" value={x.name} onChange={e => setD({ ...d, [kind]: d[kind].map((y, k) => (k === i ? { ...y, name: e.target.value } : y)) })} />
                  <MoneyInput value={x.amount} onChange={amount => setD({ ...d, [kind]: d[kind].map((y, k) => (k === i ? { ...y, amount } : y)) })} />
                  <select className="input" value={x.per} onChange={e => setD({ ...d, [kind]: d[kind].map((y, k) => (k === i ? { ...y, per: e.target.value } : y)) })}>
                    <option value="month">Mỗi tháng</option>{kind === 'allowances' ? <option value="shift">Mỗi ca</option> : <option value="late">Mỗi lần đi muộn</option>}
                  </select>
                  <button type="button" className="btn-ghost text-rose-600" aria-label="Xóa" onClick={() => setD({ ...d, [kind]: d[kind].filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          ))}
        </div>}
      </Modal>
    </div>
  );
}
