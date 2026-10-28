import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { ShiftsDialog } from './ShiftsDialog';
import { DAY_NAMES, addDays, mondayOf, shortDate, weekDates, type Shift } from './week';

type Data = { employees: { id: number; code: string; name: string; position: string }[]; shifts: Shift[]; entries: { id: number; employeeId: number; shiftId: number; date: string }[] };
type Drag = { kind: 'shift'; shiftId: number } | { kind: 'entry'; id: number };

/** Weekly schedule: drag a shift from the palette onto a cell to assign, drag an assigned shift to move it. */
export function SchedulePage({ initialMonday }: { initialMonday?: string } = {}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [monday, setMonday] = useState(initialMonday ?? mondayOf());
  const [over, setOver] = useState<string | null>(null);
  const [editShifts, setEditShifts] = useState(false);
  const days = weekDates(monday);
  const q = useQuery({ queryKey: ['schedule', monday], queryFn: () => api<Data>('/schedule', { query: { from: days[0], to: days[6] } }) });
  const editable = can('employees.edit');
  const refresh = () => qc.invalidateQueries({ queryKey: ['schedule'] });
  const run = (p: Promise<unknown>) => p.then(refresh).catch(toastError);
  function onDrop(e: React.DragEvent, employeeId: number, date: string) {
    e.preventDefault(); setOver(null);
    let d: Drag;
    try { d = JSON.parse(e.dataTransfer.getData('text/plain')) as Drag; } catch { return; }
    if (d.kind === 'shift') run(api('/schedule', { body: { employeeId, shiftId: d.shiftId, date } }));
    else run(api('/schedule/move', { body: { id: d.id, employeeId, date } }));
  }
  const drag = (d: Drag) => (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', JSON.stringify(d)); e.dataTransfer.effectAllowed = 'copyMove'; };
  const shiftOf = (id: number) => q.data?.shifts.find(s => s.id === id);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Lịch làm việc</h1>
        <button type="button" className="btn" aria-label="Tuần trước" onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft size={16} /></button>
        <span className="min-w-36 text-center text-sm font-medium">{shortDate(days[0])} – {shortDate(days[6])}</span>
        <button type="button" className="btn" aria-label="Tuần sau" onClick={() => setMonday(addDays(monday, 7))}><ChevronRight size={16} /></button>
        <button type="button" className="btn" onClick={() => setMonday(mondayOf())}>Tuần này</button>
        {editable && <button type="button" className="btn" onClick={() => api<{ copied: number }>('/schedule/copy-week', { body: { fromMonday: addDays(monday, -7), toMonday: monday } }).then(r => { toast(`Đã sao chép ${r.copied} ca`); refresh(); }).catch(toastError)}><Copy size={16} />Sao chép tuần trước</button>}
      </div>
      {editable && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-3 text-sm">
          <span className="text-slate-500">Kéo ca vào lịch:</span>
          {q.data?.shifts.filter(s => s.isActive).map(s => (
            <button key={s.id} type="button" draggable onDragStart={drag({ kind: 'shift', shiftId: s.id })} aria-label={`Kéo ca ${s.name}`}
              className="cursor-grab rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: s.color }}>{s.name} {s.start}–{s.end}</button>
          ))}
          <button type="button" className="btn-ghost ml-auto" onClick={() => setEditShifts(true)}><Plus size={14} />Thiết lập ca</button>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="w-48 p-2 text-left">Nhân viên</th>{days.map((d, i) => <th key={d} className="p-2 text-center font-medium">{DAY_NAMES[i]}<div className="text-xs font-normal text-slate-400">{shortDate(d)}</div></th>)}</tr></thead>
          <tbody>
            {q.data?.employees.map(emp => (
              <tr key={emp.id} className="border-t border-slate-100">
                <td className="p-2"><div className="font-medium">{emp.name}</div><div className="text-xs text-slate-500">{emp.code}{emp.position ? ` · ${emp.position}` : ''}</div></td>
                {days.map(d => {
                  const key = `${emp.id}-${d}`;
                  return (
                    <td key={d} data-testid={`cell-${key}`} className={clsx('h-16 border-l border-slate-100 p-1 align-top', over === key && 'bg-brand-50')}
                      onDragOver={e => { if (editable) { e.preventDefault(); setOver(key); } }} onDragLeave={() => setOver(null)} onDrop={e => editable && onDrop(e, emp.id, d)}>
                      <div className="flex flex-col gap-1">
                        {q.data!.entries.filter(x => x.employeeId === emp.id && x.date === d).map(x => {
                          const s = shiftOf(x.shiftId);
                          return (
                            <span key={x.id} draggable={editable} onDragStart={drag({ kind: 'entry', id: x.id })} className="group flex items-center justify-between rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: s?.color ?? '#64748b' }} title={s ? `${s.start}–${s.end}` : ''}>
                              {s?.name ?? 'Ca'}
                              {editable && <button type="button" aria-label="Bỏ ca" className="opacity-0 group-hover:opacity-100" onClick={() => run(api(`/schedule/${x.id}`, { method: 'DELETE' }))}><X size={12} /></button>}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {q.data && !q.data.employees.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Chưa có nhân viên đang làm việc ở chi nhánh này</td></tr>}
          </tbody>
        </table>
      </div>
      <ShiftsDialog open={editShifts} onClose={() => { setEditShifts(false); refresh(); }} />
    </div>
  );
}
