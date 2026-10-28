import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { DAY_NAMES, addDays, hoursText, localTime, mondayOf, shortDate, toInstant, weekDates, type Shift } from './week';

type Row = { id: number | null; employeeId: number; shiftId: number; date: string; checkIn: string | null; checkOut: string | null; status: string; late: number; early: number; overtime: number; worked: number; manual: boolean; note: string };
const STATUS: Record<string, { label: string; tone: string }> = {
  scheduled: { label: 'Chưa chấm', tone: 'bg-slate-50 text-slate-500' }, present: { label: 'Có mặt', tone: 'bg-emerald-50 text-emerald-800' },
  absent: { label: 'Vắng', tone: 'bg-rose-50 text-rose-700' }, paidLeave: { label: 'Nghỉ có phép', tone: 'bg-sky-50 text-sky-700' }, unpaidLeave: { label: 'Nghỉ không lương', tone: 'bg-amber-50 text-amber-700' },
};

export function TimesheetsPage({ initialMonday }: { initialMonday?: string } = {}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [monday, setMonday] = useState(initialMonday ?? mondayOf());
  const days = weekDates(monday);
  const [edit, setEdit] = useState<(Row & { inT: string; outT: string }) | null>(null);
  // Without employees.view the API returns only the user's own rows; the list then falls back to "me".
  const emps = useQuery({ queryKey: ['employees', 'active'], enabled: can('employees.view'), queryFn: () => api<{ items: { id: number; code: string; name: string }[] }>('/employees', { query: { pageSize: 100 } }).catch(() => ({ items: [] })) });
  const shifts = useQuery({ queryKey: ['work-shifts'], queryFn: () => api<Shift[]>('/work-shifts') });
  const me = useQuery({ queryKey: ['employees', 'me'], queryFn: () => api<{ id: number; code: string; name: string } | null>('/employees/me') });
  const ts = useQuery({ queryKey: ['timesheets', monday], queryFn: () => api<{ items: Row[] }>('/timesheets', { query: { from: days[0], to: days[6] } }) });
  const shiftOf = (id: number) => shifts.data?.find(s => s.id === id);
  const refresh = () => qc.invalidateQueries({ queryKey: ['timesheets'] });
  async function save() {
    if (!edit) return;
    const s = shiftOf(edit.shiftId)!;
    try {
      await api('/timesheets', { method: 'PUT', body: {
        employeeId: edit.employeeId, shiftId: edit.shiftId, date: edit.date, status: edit.status,
        checkIn: edit.inT ? toInstant(edit.date, edit.inT, s) : null, checkOut: edit.outT ? toInstant(edit.date, edit.outT, s) : null, note: edit.note,
      } });
      setEdit(null); refresh(); toast('Đã cập nhật chấm công');
    } catch (e) { toastError(e); }
  }
  async function punch() {
    try { const r = await api<Row>('/timesheets/punch', { body: {} }); toast(r.checkOut ? `Đã chấm công ra lúc ${localTime(r.checkOut)}` : `Đã chấm công vào lúc ${localTime(r.checkIn)}`); refresh(); } catch (e) { toastError(e); }
  }
  const people = emps.data?.items.length ? emps.data.items : me.data ? [me.data] : [];
  const visible = people.filter(e => ts.data?.items.some(r => r.employeeId === e.id));
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Bảng chấm công</h1>
        {me.data && <button type="button" className="btn-primary" onClick={punch}><Clock size={16} />Chấm công</button>}
        <button type="button" className="btn" aria-label="Tuần trước" onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft size={16} /></button>
        <span className="min-w-36 text-center text-sm font-medium">{shortDate(days[0])} – {shortDate(days[6])}</span>
        <button type="button" className="btn" aria-label="Tuần sau" onClick={() => setMonday(addDays(monday, 7))}><ChevronRight size={16} /></button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="w-48 p-2 text-left">Nhân viên</th>{days.map((d, i) => <th key={d} className="p-2 text-center font-medium">{DAY_NAMES[i]}<div className="text-xs font-normal text-slate-400">{shortDate(d)}</div></th>)}</tr></thead>
          <tbody>{visible.map(emp => (
            <tr key={emp.id} className="border-t border-slate-100">
              <td className="p-2"><div className="font-medium">{emp.name}</div><div className="text-xs text-slate-500">{emp.code}</div></td>
              {days.map(d => (
                <td key={d} className="border-l border-slate-100 p-1 align-top">
                  {ts.data!.items.filter(r => r.employeeId === emp.id && r.date === d).map(r => (
                    <button key={`${r.shiftId}`} type="button" data-testid={`ts-${r.employeeId}-${r.shiftId}-${r.date}`} disabled={!can('employees.edit')}
                      onClick={() => setEdit({ ...r, inT: localTime(r.checkIn), outT: localTime(r.checkOut) })}
                      className={clsx('mb-1 block w-full rounded px-1.5 py-1 text-left text-xs', STATUS[r.status]?.tone)}>
                      <div className="font-medium">{shiftOf(r.shiftId)?.name}{r.manual ? ' ✎' : ''}</div>
                      <div>{r.checkIn || r.checkOut ? `${localTime(r.checkIn) || '--'} → ${localTime(r.checkOut) || '--'}` : STATUS[r.status]?.label}</div>
                      {(r.late > 0 || r.overtime > 0) && <div>{r.late > 0 && <span className="text-rose-700">Muộn {r.late}′ </span>}{r.overtime > 0 && <span className="text-sky-700">OT {hoursText(r.overtime)}</span>}</div>}
                    </button>
                  ))}
                </td>
              ))}
            </tr>
          ))}
          {ts.data && !visible.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Chưa có lịch làm việc trong tuần — hãy xếp lịch trước.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} size="sm" title={`Chấm công ${edit ? `${people.find(e => e.id === edit.employeeId)?.name ?? ''} · ${shortDate(edit.date)}` : ''}`} onClose={() => setEdit(null)}
        footer={<button type="button" className="btn-primary" onClick={save}>Lưu</button>}>
        {edit && <div className="space-y-3">
          <p className="text-sm text-slate-500">{shiftOf(edit.shiftId)?.name} {shiftOf(edit.shiftId)?.start}–{shiftOf(edit.shiftId)?.end}</p>
          <Field label="Trạng thái"><select className="input" aria-label="Trạng thái" value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giờ vào"><input type="time" className="input" aria-label="Giờ vào" value={edit.inT} onChange={e => setEdit({ ...edit, inT: e.target.value })} /></Field>
            <Field label="Giờ ra"><input type="time" className="input" aria-label="Giờ ra" value={edit.outT} onChange={e => setEdit({ ...edit, outT: e.target.value })} /></Field>
          </div>
          <Field label="Ghi chú"><input className="input" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">"Có mặt" mà để trống giờ vào/ra được tính đủ ca.</p>
        </div>}
      </Modal>
    </div>
  );
}
