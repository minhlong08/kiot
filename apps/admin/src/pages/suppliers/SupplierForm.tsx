import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supplierInputSchema } from '@pd/shared';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

export type SupplierDraft = { id?: number; code: string; name: string; phone: string; email: string; taxCode: string; address: string; company: string; groupId: number | null; note: string; isActive: boolean };
const empty: SupplierDraft = { code: '', name: '', phone: '', email: '', taxCode: '', address: '', company: '', groupId: null, note: '', isActive: true };

export const useSupplierGroups = () => useQuery({ queryKey: ['supplier-groups'], queryFn: () => api<{ id: number; name: string; supplierCount: number }[]>('/supplier-groups') });

export function SupplierForm({ value, onClose, onSaved }: { value: Partial<SupplierDraft> | null; onClose: () => void; onSaved?: (s: { id: number; name: string; code: string }) => void }) {
  const qc = useQueryClient();
  const groups = useSupplierGroups();
  const [d, setD] = useState<SupplierDraft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (value) { setD({ ...empty, ...value }); setErrors({}); } }, [value]);
  const set = (p: Partial<SupplierDraft>) => setD(cur => ({ ...cur, ...p }));
  async function save() {
    const { id, ...body } = d;
    const parsed = supplierInputSchema.safeParse({ ...body, code: body.code || undefined });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])));
    try {
      const s = await api<{ id: number; name: string; code: string }>(id ? `/suppliers/${id}` : '/suppliers', { method: id ? 'PUT' : 'POST', body: { ...body, code: body.code || undefined } });
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      await qc.invalidateQueries({ queryKey: ['supplier'] });
      toast(`Đã lưu ${s.code}`);
      onSaved?.(s);
      onClose();
    } catch (e) { toastError(e); }
  }
  const input = (k: keyof SupplierDraft, label: string, placeholder?: string) => (
    <Field label={label}><input className="input" placeholder={placeholder} value={String(d[k] ?? '')} onChange={e => set({ [k]: e.target.value } as Partial<SupplierDraft>)} />{errors[k] && <span className="text-xs text-rose-600">{errors[k]}</span>}</Field>
  );
  return (
    <Modal open={!!value} title={d.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" onClick={save}>Lưu</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {input('code', 'Mã nhà cung cấp', 'Tự động')}
        {input('name', 'Tên nhà cung cấp', 'Bắt buộc')}
        {input('phone', 'Điện thoại')}
        {input('email', 'Email')}
        {input('company', 'Công ty')}
        {input('taxCode', 'Mã số thuế')}
        <div className="sm:col-span-2">{input('address', 'Địa chỉ')}</div>
        <Field label="Nhóm nhà cung cấp">
          <select className="input" value={d.groupId ?? ''} onChange={e => set({ groupId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— Không có —</option>
            {groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        {input('note', 'Ghi chú')}
      </div>
    </Modal>
  );
}
