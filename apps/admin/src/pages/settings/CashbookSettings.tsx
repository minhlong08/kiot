import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import type { CashCategory, Fund } from '../../lib/cash';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { toast, toastError } from '../../components/toast';
import { useBranches } from '../products/useLookups';

const TYPE: Record<Fund['type'], string> = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử' };
type FundDraft = Omit<Fund, 'id' | 'balance'> & { id?: number };
type CatDraft = { id?: number; kind: 'in' | 'out'; name: string; affectsPnl: boolean };
const emptyFund: FundDraft = { type: 'bank', name: '', bankName: '', bankBin: '', accountNumber: '', accountName: '', branchId: null, openingBalance: 0, isActive: true };

export function CashbookSettings() {
  const qc = useQueryClient();
  const funds = useQuery({ queryKey: ['cash-funds', 'all'], queryFn: () => api<Fund[]>('/cash-funds', { query: { all: '1' } }) });
  const cats = useQuery({ queryKey: ['cash-categories'], queryFn: () => api<(CashCategory & { affectsPnl: boolean })[]>('/cash-categories') });
  const branches = useBranches();
  const [fund, setFund] = useState<FundDraft | null>(null);
  const [cat, setCat] = useState<CatDraft | null>(null);
  const refresh = (k: string) => qc.invalidateQueries({ queryKey: [k] });
  const saveFund = useMutation({
    mutationFn: ({ id, ...b }: FundDraft) => api(id ? `/cash-funds/${id}` : '/cash-funds', { method: id ? 'PUT' : 'POST', body: b }),
    onSuccess: () => { refresh('cash-funds'); setFund(null); toast('Đã lưu quỹ'); }, onError: toastError,
  });
  const delFund = useMutation({ mutationFn: (id: number) => api<{ deactivated?: boolean }>(`/cash-funds/${id}`, { method: 'DELETE' }), onSuccess: r => { refresh('cash-funds'); toast(r?.deactivated ? 'Quỹ đã có giao dịch nên được ngừng hoạt động' : 'Đã xóa quỹ'); }, onError: toastError });
  const saveCat = useMutation({
    mutationFn: ({ id, ...b }: CatDraft) => api(id ? `/cash-categories/${id}` : '/cash-categories', { method: id ? 'PUT' : 'POST', body: b }),
    onSuccess: () => { refresh('cash-categories'); setCat(null); toast('Đã lưu loại thu chi'); }, onError: toastError,
  });
  const delCat = useMutation({ mutationFn: (id: number) => api(`/cash-categories/${id}`, { method: 'DELETE' }), onSuccess: () => { refresh('cash-categories'); toast('Đã xóa'); }, onError: toastError });
  const branchName = (id: number | null | undefined) => (id ? branches.data?.items.find(b => b.id === id)?.name ?? '' : 'Toàn hệ thống');
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Quỹ tiền</h3><button type="button" className="btn" onClick={() => setFund(emptyFund)}><Plus size={16} />Thêm quỹ</button></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="p-2">Tên quỹ</th><th className="p-2">Loại</th><th className="p-2">Tài khoản</th><th className="p-2">Mã BIN</th><th className="p-2">Chi nhánh</th><th className="p-2 text-right">Số dư đầu</th><th className="p-2 text-right">Số dư hiện tại</th><th className="p-2">Trạng thái</th><th /></tr></thead>
          <tbody>{funds.data?.map(f => (
            <tr key={f.id} className="border-t border-slate-100">
              <td className="p-2 font-medium">{f.name}</td><td className="p-2">{TYPE[f.type]}</td>
              <td className="p-2">{[f.bankName, f.accountNumber, f.accountName].filter(Boolean).join(' · ')}</td><td className="p-2">{f.bankBin}</td>
              <td className="p-2">{branchName(f.branchId)}</td><td className="p-2 text-right tabular-nums">{formatVnd(f.openingBalance ?? 0)}</td>
              <td className="p-2 text-right tabular-nums">{f.balance === undefined ? '' : formatVnd(f.balance)}</td>
              <td className="p-2">{f.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}</td>
              <td className="whitespace-nowrap p-2 text-right">
                <button type="button" className="btn-ghost" aria-label={`Sửa ${f.name}`} onClick={() => setFund({ ...emptyFund, ...f })}><Pencil size={14} /></button>
                <button type="button" className="btn-ghost text-rose-600" aria-label={`Xóa ${f.name}`} onClick={() => delFund.mutate(f.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-medium">Loại thu chi</h3><button type="button" className="btn" onClick={() => setCat({ kind: 'out', name: '', affectsPnl: true })}><Plus size={16} />Thêm loại</button></div>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="p-2">Tên</th><th className="p-2">Thu/Chi</th><th className="p-2">Hạch toán KQKD</th><th /></tr></thead>
          <tbody>{cats.data?.map(c => (
            <tr key={c.id} className="border-t border-slate-100">
              <td className="p-2">{c.name}{c.isSystem && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-500">Hệ thống</span>}</td>
              <td className="p-2">{c.kind === 'in' ? 'Thu' : 'Chi'}</td><td className="p-2">{c.affectsPnl ? 'Có' : 'Không'}</td>
              <td className="whitespace-nowrap p-2 text-right">{!c.isSystem && <>
                <button type="button" className="btn-ghost" aria-label={`Sửa ${c.name}`} onClick={() => setCat({ id: c.id, kind: c.kind, name: c.name, affectsPnl: c.affectsPnl })}><Pencil size={14} /></button>
                <button type="button" className="btn-ghost text-rose-600" aria-label={`Xóa ${c.name}`} onClick={() => delCat.mutate(c.id)}><Trash2 size={14} /></button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <Modal open={!!fund} title={fund?.id ? 'Sửa quỹ' : 'Thêm quỹ'} onClose={() => setFund(null)} footer={<button type="button" className="btn-primary" disabled={!fund?.name || saveFund.isPending} onClick={() => fund && saveFund.mutate(fund)}>Lưu</button>}>
        {fund && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Loại quỹ"><select className="input" value={fund.type} onChange={e => setFund({ ...fund, type: e.target.value as Fund['type'] })}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Tên quỹ"><input className="input" value={fund.name} onChange={e => setFund({ ...fund, name: e.target.value })} /></Field>
          {fund.type !== 'cash' && <>
            <Field label="Ngân hàng / Ví"><input className="input" value={fund.bankName} onChange={e => setFund({ ...fund, bankName: e.target.value })} /></Field>
            <Field label="Mã BIN ngân hàng (VietQR)"><input className="input" inputMode="numeric" value={fund.bankBin} onChange={e => setFund({ ...fund, bankBin: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></Field>
            <Field label="Số tài khoản"><input className="input" value={fund.accountNumber} onChange={e => setFund({ ...fund, accountNumber: e.target.value })} /></Field>
            <Field label="Chủ tài khoản"><input className="input" value={fund.accountName} onChange={e => setFund({ ...fund, accountName: e.target.value })} /></Field>
          </>}
          <Field label="Chi nhánh"><select className="input" value={fund.branchId ?? ''} onChange={e => setFund({ ...fund, branchId: e.target.value ? Number(e.target.value) : null })}><option value="">Toàn hệ thống</option>{branches.data?.items.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Số dư đầu"><MoneyInput value={fund.openingBalance ?? 0} onChange={v => setFund({ ...fund, openingBalance: v })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fund.isActive} onChange={e => setFund({ ...fund, isActive: e.target.checked })} />Đang hoạt động</label>
        </div>}
      </Modal>
      <Modal open={!!cat} size="sm" title={cat?.id ? 'Sửa loại thu chi' : 'Thêm loại thu chi'} onClose={() => setCat(null)} footer={<button type="button" className="btn-primary" disabled={!cat?.name || saveCat.isPending} onClick={() => cat && saveCat.mutate(cat)}>Lưu</button>}>
        {cat && <div className="space-y-3">
          <Field label="Thu/Chi"><select className="input" value={cat.kind} disabled={!!cat.id} onChange={e => setCat({ ...cat, kind: e.target.value as 'in' | 'out' })}><option value="in">Thu</option><option value="out">Chi</option></select></Field>
          <Field label="Tên loại"><input className="input" value={cat.name} onChange={e => setCat({ ...cat, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cat.affectsPnl} onChange={e => setCat({ ...cat, affectsPnl: e.target.checked })} />Hạch toán vào kết quả kinh doanh</label>
        </div>}
      </Modal>
    </div>
  );
}
