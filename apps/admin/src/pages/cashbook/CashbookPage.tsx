import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import clsx from 'clsx';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCashCategories, useFunds } from '../../lib/cash';
import { toast, toastError } from '../../components/toast';
import { ConfirmModal } from '../../components/Modal';
import { CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter, resolveDateRange, useListState, type Column } from '../../components/list';
import { TransferForm, VoucherForm } from './VoucherForm';
import { printVoucher } from './printVoucher';

type Row = { id: number; code: string; createdAt: string; kind: 'in' | 'out'; amount: number; categoryName: string; counterpartyName: string; counterpartyType: string; status: string; sourceType: string | null; sourceCode: string | null; fundName: string; createdByName: string; note: string; affectsPnl: boolean };
type Summary = { opening: number; in: number; out: number; closing: number };
const TABS = [{ key: 'cash', label: 'Tiền mặt' }, { key: 'bank', label: 'Ngân hàng' }, { key: 'ewallet', label: 'Ví điện tử' }, { key: 'all', label: 'Tổng quỹ' }];
const SOURCE_LABEL: Record<string, string> = { invoice: 'Hóa đơn', return: 'Trả hàng', receipt: 'Nhập hàng', purchaseReturn: 'Trả hàng nhập', customerOrder: 'Đặt hàng', supplierPayment: 'Thanh toán NCC', customerPayment: 'Thu nợ khách', servicePurchase: 'Mua dịch vụ', manual: 'Lập thủ công', transfer: 'Chuyển quỹ', payroll: 'Bảng lương', codReconciliation: 'Đối soát COD' };
const PARTY: Record<string, string> = { customer: 'Khách hàng', supplier: 'Nhà cung cấp', employee: 'Nhân viên', other: 'Khác' };

export function CashbookPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const funds = useFunds();
  const categories = useCashCategories();
  const { state, set } = useListState({ tab: 'cash', date: 'thisMonth', fundIds: [] as string[], kind: '', categoryIds: [] as string[], counterpartyType: [] as string[], affectsPnl: '', status: ['completed'] as string[] });
  const [form, setForm] = useState<'in' | 'out' | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const range = resolveDateRange(state.date as string);
  const query = {
    page: state.page, pageSize: state.pageSize, search: state.search, fundType: state.tab as string, fundIds: state.fundIds as string[], kind: (state.kind as string) || undefined,
    categoryIds: state.categoryIds as string[], counterpartyType: state.counterpartyType as string[], affectsPnl: (state.affectsPnl as string) || undefined, status: state.status as string[], ...range,
  };
  const list = useQuery({ queryKey: ['cash-vouchers', query], queryFn: () => api<{ items: Row[]; total: number; summary: Summary }>('/cash-vouchers', { query }) });
  const cancel = useMutation({ mutationFn: (id: number) => api(`/cash-vouchers/${id}/cancel`, { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['cash-vouchers'] }); toast('Đã hủy phiếu'); }, onError: toastError });
  const s = list.data?.summary;
  const tabFunds = (funds.data ?? []).filter(f => state.tab === 'all' || f.type === state.tab);
  const columns: Column<Row>[] = [
    { key: 'code', header: 'Mã phiếu' }, { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
    { key: 'categoryName', header: 'Loại thu chi' }, { key: 'counterpartyName', header: 'Người nộp/nhận' },
    { key: 'fundName', header: 'Quỹ', hiddenByDefault: state.tab !== 'all' },
    { key: 'amount', header: 'Giá trị', align: 'right', render: r => <span className={clsx('tabular-nums font-medium', r.status === 'cancelled' ? 'text-slate-400 line-through' : r.kind === 'in' ? 'text-emerald-700' : 'text-rose-700')}>{r.kind === 'in' ? '' : '-'}{formatVnd(r.amount)}</span> },
  ];
  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-2">
        {TABS.map(t => <button key={t.key} type="button" onClick={() => set({ tab: t.key, fundIds: [] })} className={clsx('-mb-px border-b-2 px-4 py-2 text-sm font-medium', state.tab === t.key ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500')}>{t.label}</button>)}
      </div>
      <div data-testid="cash-summary" className="grid grid-cols-2 gap-2 bg-white px-4 py-3 text-sm md:grid-cols-4">
        {([['Quỹ đầu kỳ', s?.opening, 'opening'], ['Tổng thu', s?.in, 'in'], ['Tổng chi', s?.out, 'out'], ['Tồn quỹ', s?.closing, 'closing']] as const).map(([label, v, key], i) => (
          <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div data-testid={`cash-${key}`} className={clsx('text-lg font-semibold tabular-nums', i === 1 && 'text-emerald-700', i === 2 && 'text-rose-700')}>{i === 2 && v ? '-' : ''}{formatVnd(v ?? 0)}</div></div>
        ))}
      </div>
      <ListPage
        sidebar={
          <FilterSidebar title="Sổ quỹ">
            {state.tab !== 'cash' && tabFunds.length > 0 && <FilterSection title="Quỹ"><CheckboxFilter options={tabFunds.map(f => ({ value: String(f.id), label: f.name }))} value={state.fundIds as string[]} onChange={v => set({ fundIds: v })} /></FilterSection>}
            <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear', 'all']} /></FilterSection>
            <FilterSection title="Loại chứng từ"><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'in', label: 'Phiếu thu' }, { value: 'out', label: 'Phiếu chi' }]} value={state.kind as string} onChange={v => set({ kind: v })} /></FilterSection>
            <FilterSection title="Loại thu chi" defaultOpen={false}><CheckboxFilter options={(categories.data ?? []).filter(c => !state.kind || c.kind === state.kind).map(c => ({ value: String(c.id), label: `${c.kind === 'in' ? 'Thu' : 'Chi'}: ${c.name}` }))} value={state.categoryIds as string[]} onChange={v => set({ categoryIds: v })} /></FilterSection>
            <FilterSection title="Đối tượng nộp/nhận" defaultOpen={false}><CheckboxFilter options={Object.entries(PARTY).map(([value, label]) => ({ value, label }))} value={state.counterpartyType as string[]} onChange={v => set({ counterpartyType: v })} /></FilterSection>
            <FilterSection title="Hạch toán kết quả kinh doanh" defaultOpen={false}><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'true', label: 'Có' }, { value: 'false', label: 'Không' }]} value={state.affectsPnl as string} onChange={v => set({ affectsPnl: v })} /></FilterSection>
            <FilterSection title="Trạng thái" defaultOpen={false}><CheckboxFilter options={[{ value: 'completed', label: 'Đã thanh toán' }, { value: 'cancelled', label: 'Đã hủy' }]} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã phiếu, người nộp/nhận" onExport={() => download('/cash-vouchers/export', query, 'so-quy.xlsx')}
          extra={can('cashbook.create') ? <>
            <button type="button" className="btn-primary" onClick={() => setForm('in')}><Plus size={16} />Lập phiếu thu</button>
            <button type="button" className="btn-primary" onClick={() => setForm('out')}><Minus size={16} />Lập phiếu chi</button>
            <button type="button" className="btn" onClick={() => setTransfer(true)}><ArrowLeftRight size={16} />Chuyển quỹ</button>
          </> : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="cash-vouchers" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} loading={list.isLoading}
          renderExpanded={r => (
            <div className="space-y-2 p-4 text-sm">
              <div className="grid grid-cols-2 gap-x-6 md:grid-cols-4">
                <div><span className="text-slate-500">Quỹ: </span>{r.fundName}</div><div><span className="text-slate-500">Người tạo: </span>{r.createdByName}</div>
                <div><span className="text-slate-500">Đối tượng: </span>{PARTY[r.counterpartyType] ?? r.counterpartyType}</div>
                <div><span className="text-slate-500">Chứng từ gốc: </span>{SOURCE_LABEL[r.sourceType ?? ''] ?? ''} {r.sourceCode !== r.code ? r.sourceCode : ''}</div>
                <div><span className="text-slate-500">Hạch toán KQKD: </span>{r.affectsPnl ? 'Có' : 'Không'}</div>
                {r.note && <div className="col-span-2"><span className="text-slate-500">Ghi chú: </span>{r.note}</div>}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => printVoucher(r.id).catch(toastError)}>In phiếu</button>
                {r.status !== 'cancelled' && ['manual', 'transfer'].includes(r.sourceType ?? '') && can('cashbook.delete') && <button type="button" className="btn text-rose-600" onClick={() => setCancelId(r.id)}>Hủy phiếu</button>}
              </div>
            </div>
          )} />
      </ListPage>
      <VoucherForm kind={form} defaultFundType={state.tab as string} onClose={() => setForm(null)} />
      <TransferForm open={transfer} onClose={() => setTransfer(false)} />
      <ConfirmModal open={cancelId !== null} danger title="Hủy phiếu" confirmLabel="Hủy phiếu" onClose={() => setCancelId(null)} message="Phiếu sẽ không còn tính vào số dư quỹ và công nợ liên quan sẽ được hoàn lại." onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </div>
  );
}
