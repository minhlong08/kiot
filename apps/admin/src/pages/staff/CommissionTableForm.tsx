import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { CommissionRule } from '@pd/shared';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { ProductPicker } from '../../components/docs/ProductPicker';
import { useGroups } from '../products/useLookups';

export type CommissionTable = { id: number; name: string; rules: CommissionRule[]; isActive: boolean };
type Row = CommissionRule & { label?: string };

/** Rules editor: the most specific matching rule pays (hàng hóa > nhóm hàng > tất cả). */
export function CommissionTableForm({ table, onClose }: { table: CommissionTable | null; onClose: () => void }) {
  const qc = useQueryClient();
  const groups = useGroups();
  const [name, setName] = useState(table?.name ?? '');
  const [isActive, setActive] = useState(table?.isActive ?? true);
  const [rules, setRules] = useState<Row[]>(table?.rules ?? []);
  const [picking, setPicking] = useState(false);
  const patch = (i: number, p: Partial<Row>) => setRules(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  async function save() {
    try {
      const body = { name, isActive, rules: rules.map(({ label: _l, ...r }) => r) };
      await api(table ? `/commission-tables/${table.id}` : '/commission-tables', { method: table ? 'PUT' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['commission-tables'] });
      toast('Đã lưu bảng hoa hồng');
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open size="lg" title={table ? 'Sửa bảng hoa hồng' : 'Thêm bảng hoa hồng'} onClose={onClose} footer={<button type="button" className="btn-primary" disabled={!name.trim()} onClick={save}>Lưu</button>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Tên bảng hoa hồng"><input className="input" aria-label="Tên bảng hoa hồng" value={name} onChange={e => setName(e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={isActive} onChange={e => setActive(e.target.checked)} />Đang áp dụng</label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="p-2">Áp dụng cho</th><th className="p-2">Loại</th><th className="p-2">Mức</th><th /></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="p-2">
                {r.scope === 'all' && 'Tất cả hàng hóa'}
                {r.scope === 'group' && <select className="input" aria-label={`Nhóm hàng của dòng ${i + 1}`} value={r.refId ?? ''} onChange={e => patch(i, { refId: e.target.value ? Number(e.target.value) : null })}><option value="">Chọn nhóm</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
                {r.scope === 'product' && (r.label ?? `Hàng hóa #${r.refId}`)}
              </td>
              <td className="p-2"><select className="input" aria-label={`Loại của dòng ${i + 1}`} value={r.type} onChange={e => patch(i, { type: e.target.value as Row['type'] })}><option value="percent">% doanh thu</option><option value="fixed">VND / sản phẩm</option></select></td>
              <td className="p-2"><input className="input w-32" inputMode="decimal" aria-label={`Mức của dòng ${i + 1}`} value={r.value} onChange={e => patch(i, { value: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></td>
              <td className="p-2 text-right"><button type="button" className="btn-ghost text-rose-600" aria-label={`Xóa dòng ${i + 1}`} onClick={() => setRules(rs => rs.filter((_, k) => k !== i))}><Trash2 size={14} /></button></td>
            </tr>
          ))}
          {!rules.length && <tr><td colSpan={4} className="p-4 text-center text-slate-500">Chưa có quy tắc</td></tr>}
        </tbody>
      </table>
      {picking && <ProductPicker className="mt-3" placeholder="Tìm hàng hóa" onPick={p => { setRules(rs => [...rs, { scope: 'product', refId: p.productId, type: 'percent', value: 0, label: `${p.code} - ${p.name}` }]); setPicking(false); }} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {!rules.some(r => r.scope === 'all') && <button type="button" className="btn" onClick={() => setRules(rs => [...rs, { scope: 'all', refId: null, type: 'percent', value: 0 }])}>Thêm cho tất cả</button>}
        <button type="button" className="btn" onClick={() => setRules(rs => [...rs, { scope: 'group', refId: null, type: 'percent', value: 0 }])}>Thêm theo nhóm hàng</button>
        <button type="button" className="btn" onClick={() => setPicking(true)}>Thêm theo hàng hóa</button>
      </div>
    </Modal>
  );
}
