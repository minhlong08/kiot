import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useCashCategories, useFunds } from '../../lib/cash';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import { SupplierPicker, type PickedSupplier } from '../purchasing/SupplierPicker';

type Kind = 'in' | 'out';
type Party = 'customer' | 'supplier' | 'employee' | 'other';
const PARTY: Record<Party, string> = { customer: 'Khách hàng', supplier: 'Nhà cung cấp', employee: 'Nhân viên', other: 'Khác' };

export function VoucherForm({ kind, defaultFundType, onClose }: { kind: Kind | null; defaultFundType: string; onClose: () => void }) {
  const qc = useQueryClient();
  const funds = useFunds();
  const categories = useCashCategories();
  const users = useQuery({ queryKey: ['users-light'], queryFn: () => api<{ items: { id: number; fullName: string }[] }>('/users', { query: { pageSize: 100 } }).catch(() => ({ items: [] })) });
  const [f, setF] = useState({ fundId: 0, categoryId: 0, amount: 0, party: 'other' as Party, name: '', employeeId: 0, note: '', postToDebt: false, date: '' });
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  useEffect(() => {
    if (!kind) return;
    const fund = funds.data?.find(x => x.type === (defaultFundType === 'all' ? 'cash' : defaultFundType)) ?? funds.data?.[0];
    setF({ fundId: fund?.id ?? 0, categoryId: 0, amount: 0, party: 'other', name: '', employeeId: 0, note: '', postToDebt: false, date: '' });
    setCustomer(null); setSupplier(null);
  }, [kind, funds.data, defaultFundType]);
  const cats = (categories.data ?? []).filter(c => c.kind === kind && c.name !== 'Chuyển quỹ');
  const debt = f.party === 'customer' ? customer?.debt : f.party === 'supplier' ? supplier?.debt : undefined;

  async function save() {
    try {
      const counterpartyId = f.party === 'customer' ? customer?.id : f.party === 'supplier' ? supplier?.id : f.party === 'employee' ? f.employeeId || null : null;
      const counterpartyName = f.party === 'employee' ? users.data?.items.find(u => u.id === f.employeeId)?.fullName ?? '' : f.name;
      const v = await api<{ code: string }>('/cash-vouchers', { body: {
        kind, fundId: f.fundId, amount: f.amount, categoryId: f.categoryId, counterpartyType: f.party, counterpartyId: counterpartyId ?? null, counterpartyName,
        note: f.note, postToDebt: f.postToDebt && (f.party === 'customer' || f.party === 'supplier'), ...(f.date ? { at: new Date(`${f.date}T12:00:00+07:00`).toISOString() } : {}),
      } });
      await Promise.all(['cash-vouchers', 'cash-funds', 'customers', 'suppliers'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      toast(`Đã tạo ${v.code}`);
      onClose();
    } catch (e) { toastError(e); }
  }
  const label = kind === 'in' ? 'thu' : 'chi';
  return (
    <Modal open={!!kind} title={kind === 'in' ? 'Lập phiếu thu' : 'Lập phiếu chi'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Bỏ qua</button><button type="button" className="btn-primary" disabled={!f.amount || !f.categoryId || !f.fundId} onClick={save}>Lưu</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quỹ"><select className="input" value={f.fundId} onChange={e => setF({ ...f, fundId: Number(e.target.value) })}>{funds.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label={`Loại ${label}`}>
          <select className="input" aria-label={`Loại ${label}`} value={f.categoryId} onChange={e => setF({ ...f, categoryId: Number(e.target.value) })}>
            <option value={0}>Chọn loại {label}</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Số tiền"><MoneyInput value={f.amount} onChange={amount => setF({ ...f, amount })} aria-label="Số tiền" /></Field>
        <Field label="Ngày (để trống: bây giờ)"><input type="date" className="input" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Đối tượng"><select className="input" value={f.party} onChange={e => setF({ ...f, party: e.target.value as Party, postToDebt: false })}>{Object.entries(PARTY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <div>
          <span className="label">{kind === 'in' ? 'Người nộp' : 'Người nhận'}</span>
          {f.party === 'customer' && <CustomerPicker value={customer} onChange={setCustomer} placeholder="Tìm khách hàng" />}
          {f.party === 'supplier' && <SupplierPicker value={supplier} onChange={setSupplier} />}
          {f.party === 'employee' && <select className="input" value={f.employeeId} onChange={e => setF({ ...f, employeeId: Number(e.target.value) })}><option value={0}>Chọn nhân viên</option>{users.data?.items.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>}
          {f.party === 'other' && <input className="input" aria-label={kind === 'in' ? 'Tên người nộp' : 'Tên người nhận'} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}
        </div>
        {(f.party === 'customer' || f.party === 'supplier') && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.postToDebt} onChange={e => setF({ ...f, postToDebt: e.target.checked })} />
            Tính vào công nợ{debt !== undefined ? ` (nợ hiện tại ${formatVnd(debt)})` : ''}
          </label>
        )}
        <div className="sm:col-span-2"><Field label="Ghi chú"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
}

export function TransferForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const funds = useFunds();
  const [f, setF] = useState({ from: 0, to: 0, amount: 0, note: '' });
  useEffect(() => { if (open && funds.data) setF({ from: funds.data.find(x => x.type === 'cash')?.id ?? 0, to: funds.data.find(x => x.type !== 'cash')?.id ?? 0, amount: 0, note: '' }); }, [open, funds.data]);
  async function save() {
    try {
      await api('/cash-vouchers/transfer', { body: { fromFundId: f.from, toFundId: f.to, amount: f.amount, note: f.note } });
      await qc.invalidateQueries({ queryKey: ['cash-vouchers'] });
      await qc.invalidateQueries({ queryKey: ['cash-funds'] });
      toast('Đã chuyển quỹ');
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={open} size="sm" title="Chuyển quỹ" onClose={onClose} footer={<button type="button" className="btn-primary" disabled={!f.amount || f.from === f.to} onClick={save}>Lưu</button>}>
      <div className="space-y-3">
        <Field label="Từ quỹ"><select className="input" value={f.from} onChange={e => setF({ ...f, from: Number(e.target.value) })}>{funds.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Đến quỹ"><select className="input" value={f.to} onChange={e => setF({ ...f, to: Number(e.target.value) })}>{funds.data?.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Số tiền"><MoneyInput value={f.amount} onChange={amount => setF({ ...f, amount })} aria-label="Số tiền chuyển" /></Field>
        <Field label="Ghi chú"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
