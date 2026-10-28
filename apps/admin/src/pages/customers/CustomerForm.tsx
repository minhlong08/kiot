import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVINCES, customerInputSchema } from '@pd/shared';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { toast, toastError } from '../../components/toast';

export type CustomerDraft = {
  id?: number; code: string; name: string; phone: string; phone2: string; email: string; birthday: string | null; gender: 'male' | 'female' | '';
  type: 'person' | 'company'; company: string; taxCode: string; address: string; ward: string; province: string; groupId: number | null; note: string; isActive: boolean;
};
const empty: CustomerDraft = { code: '', name: '', phone: '', phone2: '', email: '', birthday: null, gender: '', type: 'person', company: '', taxCode: '', address: '', ward: '', province: '', groupId: null, note: '', isActive: true };

export type CustomerGroup = { id: number; name: string; discountPercent: number; minTotalSpent: number | null; note: string; customerCount: number };
export const useCustomerGroups = () => useQuery({ queryKey: ['customer-groups'], queryFn: () => api<CustomerGroup[]>('/customer-groups') });

export function CustomerForm({ value, onClose, onSaved }: { value: Partial<CustomerDraft> | null; onClose: () => void; onSaved?: (c: { id: number; code: string; name: string }) => void }) {
  const qc = useQueryClient();
  const groups = useCustomerGroups();
  const [d, setD] = useState<CustomerDraft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<string | null>(null);
  useEffect(() => {
    if (value) { setD({ ...empty, ...value, birthday: value.birthday ? String(value.birthday).slice(0, 10) : null }); setErrors({}); setDuplicate(null); }
  }, [value]);
  const set = (p: Partial<CustomerDraft>) => setD(cur => ({ ...cur, ...p }));

  async function save(force = false) {
    const { id, ...body } = d;
    const payload = { ...body, code: body.code || undefined, birthday: body.birthday || null };
    const parsed = customerInputSchema.safeParse(payload);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])));
    try {
      const c = await api<{ id: number; code: string; name: string }>(id ? `/customers/${id}` : '/customers', { method: id ? 'PUT' : 'POST', body: { ...payload, force } });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      toast(`Đã lưu ${c.code}`);
      onSaved?.(c);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_PHONE') setDuplicate(e.message);
      else toastError(e);
    }
  }

  const input = (k: keyof CustomerDraft, label: string, placeholder?: string, type = 'text') => (
    <Field label={label}>
      <input className="input" type={type} placeholder={placeholder} value={String(d[k] ?? '')} onChange={e => set({ [k]: e.target.value } as Partial<CustomerDraft>)} />
      {errors[k] && <span className="text-xs text-rose-600">{errors[k]}</span>}
    </Field>
  );
  return (
    <>
      <Modal open={!!value} title={d.id ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose={onClose} size="lg"
        footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" onClick={() => save(false)}>Lưu</button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {input('code', 'Mã khách hàng', 'Tự động')}
          <div className="sm:col-span-2">{input('name', 'Tên khách hàng', 'Bắt buộc')}</div>
          {input('phone', 'Điện thoại')}
          {input('phone2', 'Điện thoại 2')}
          {input('email', 'Email')}
          <Field label="Ngày sinh"><input type="date" className="input" value={d.birthday ?? ''} onChange={e => set({ birthday: e.target.value || null })} /></Field>
          <Field label="Giới tính">
            <select className="input" value={d.gender} onChange={e => set({ gender: e.target.value as CustomerDraft['gender'] })}><option value="">—</option><option value="male">Nam</option><option value="female">Nữ</option></select>
          </Field>
          <Field label="Loại khách">
            <select className="input" value={d.type} onChange={e => set({ type: e.target.value as CustomerDraft['type'] })}><option value="person">Cá nhân</option><option value="company">Công ty</option></select>
          </Field>
          {d.type === 'company' && <>{input('company', 'Tên công ty')}{input('taxCode', 'Mã số thuế')}</>}
          <div className="sm:col-span-3">{input('address', 'Địa chỉ')}</div>
          {input('ward', 'Phường/Xã')}
          <Field label="Tỉnh/Thành phố">
            <select className="input" value={d.province} onChange={e => set({ province: e.target.value })}><option value="">Chọn tỉnh/thành</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="Nhóm khách hàng">
            <select className="input" value={d.groupId ?? ''} onChange={e => set({ groupId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Không có —</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-3">{input('note', 'Ghi chú')}</div>
        </div>
      </Modal>
      <Modal open={!!duplicate} size="sm" title="Trùng số điện thoại" onClose={() => setDuplicate(null)}
        footer={<><button type="button" className="btn" onClick={() => setDuplicate(null)}>Quay lại sửa</button><button type="button" className="btn-primary" onClick={() => { setDuplicate(null); void save(true); }}>Vẫn lưu</button></>}>
        <p className="text-sm">{duplicate}. Bạn vẫn muốn lưu khách hàng này?</p>
      </Modal>
    </>
  );
}
