import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field, NumberInput } from '../../components/Field';
import { toastError } from '../../components/toast';
import type { Shift } from './week';

type Draft = Omit<Shift, 'id'> & { id?: number };
const empty: Draft = { name: '', start: '08:00', end: '17:00', breakMinutes: 0, color: '#0f766e', isActive: true };

/** Shift definitions of the branch; a shift ending at or before its start runs past midnight. */
export function ShiftsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['work-shifts'], enabled: open, queryFn: () => api<Shift[]>('/work-shifts') });
  const [d, setD] = useState<Draft>(empty);
  async function save() {
    try {
      const { id, ...body } = d;
      await api(id ? `/work-shifts/${id}` : '/work-shifts', { method: id ? 'PUT' : 'POST', body });
      setD(empty);
      await qc.invalidateQueries({ queryKey: ['work-shifts'] });
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={open} title="Thiết lập ca làm việc" onClose={onClose}>
      <table className="mb-4 w-full text-sm"><tbody>{list.data?.map(s => (
        <tr key={s.id} className="border-t border-slate-100">
          <td className="p-2"><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: s.color }} />{s.name}</td><td className="p-2">{s.start}–{s.end}</td><td className="p-2">Nghỉ {s.breakMinutes}′</td>
          <td className="p-2 text-slate-500">{s.isActive ? '' : 'Ngừng dùng'}</td><td className="p-2 text-right"><button type="button" className="btn-ghost" onClick={() => setD(s)}>Sửa</button></td>
        </tr>
      ))}</tbody></table>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tên ca"><input className="input" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Bắt đầu"><input type="time" className="input" value={d.start} onChange={e => setD({ ...d, start: e.target.value })} /></Field>
        <Field label="Kết thúc"><input type="time" className="input" value={d.end} onChange={e => setD({ ...d, end: e.target.value })} /></Field>
        <Field label="Nghỉ giữa ca (phút)"><NumberInput value={d.breakMinutes} onChange={v => setD({ ...d, breakMinutes: v })} /></Field>
        <Field label="Màu"><input type="color" className="h-9 w-16" value={d.color} onChange={e => setD({ ...d, color: e.target.value })} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={d.isActive} onChange={e => setD({ ...d, isActive: e.target.checked })} />Đang dùng</label>
      </div>
      <div className="mt-3 flex justify-end gap-2">{d.id && <button type="button" className="btn" onClick={() => setD(empty)}>Thêm ca mới</button>}<button type="button" className="btn-primary" disabled={!d.name} onClick={save}>{d.id ? 'Lưu ca' : 'Thêm ca'}</button></div>
    </Modal>
  );
}
