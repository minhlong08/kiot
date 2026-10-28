import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { Tabs } from '../../components/Tabs';
import { CheckboxFilter, DataTable, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, useListState, type Column } from '../../components/list';
import { PromotionForm, type PromoDraft } from './PromotionForm';

type PromoRow = PromoDraft & { id: number; code: string; state: 'running' | 'upcoming' | 'ended' | 'inactive' };
type Campaign = { id: number; code: string; name: string; value: number; unit: '%' | 'VND'; maxDiscount: number | null; minOrder: number; startAt: string | null; endAt: string | null; multiUse: boolean; combinable: boolean; isActive: boolean; total: number; used: number };
const STATE_LABEL = { running: 'Đang chạy', upcoming: 'Sắp diễn ra', ended: 'Đã kết thúc', inactive: 'Ngừng áp dụng' } as const;
const TYPE_LABEL: Record<string, string> = { invoiceDiscount: 'Giảm giá hóa đơn', productDiscount: 'Giảm giá hàng', buyXGetY: 'Mua hàng giảm giá/tặng hàng', giftItem: 'Tặng hàng theo hóa đơn' };

function Promotions() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ state: ['running', 'upcoming'] as string[] });
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, state: state.state as string[] };
  const list = useQuery({ queryKey: ['promotions', query], queryFn: () => api<{ items: PromoRow[]; total: number }>('/promotions', { query }) });
  const [form, setForm] = useState<Partial<PromoDraft> | null>(null);
  const del = useMutation({ mutationFn: (id: number) => api(`/promotions/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['promotions'] }); toast('Đã xóa'); }, onError: toastError });
  const columns: Column<PromoRow>[] = [
    { key: 'code', header: 'Mã chương trình' }, { key: 'name', header: 'Tên chương trình' },
    { key: 'type', header: 'Hình thức', render: r => TYPE_LABEL[r.type] },
    { key: 'startAt', header: 'Từ ngày', render: r => (r.startAt ? formatDate(r.startAt) : '—') }, { key: 'endAt', header: 'Đến ngày', render: r => (r.endAt ? formatDate(r.endAt) : '—') },
    { key: 'state', header: 'Trạng thái', render: r => <span className={r.state === 'running' ? 'font-medium text-emerald-700' : 'text-slate-500'}>{STATE_LABEL[r.state]}</span> },
  ];
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Khuyến mại"><FilterSection title="Trạng thái"><CheckboxFilter options={Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label }))} value={state.state as string[]} onChange={v => set({ state: v })} /></FilterSection></FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, tên chương trình" onCreate={can('promotions.create') ? () => setForm({}) : undefined} createLabel="Khuyến mại" />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="chương trình" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="promotions" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} loading={list.isLoading}
          renderExpanded={r => (
            <div className="flex justify-end gap-2 p-3">
              {can('promotions.delete') && <button type="button" className="btn text-rose-600" onClick={() => del.mutate(r.id)}>Xóa</button>}
              {can('promotions.edit') && <button type="button" className="btn-primary" onClick={() => setForm(r)}>Chỉnh sửa</button>}
            </div>
          )} />
      </ListPage>
      <PromotionForm value={form} onClose={() => setForm(null)} />
    </>
  );
}

function Vouchers() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['voucher-campaigns'], queryFn: () => api<Campaign[]>('/voucher-campaigns') });
  const [form, setForm] = useState<Partial<Campaign> | null>(null);
  const [codes, setCodes] = useState<Campaign | null>(null);
  const [count, setCount] = useState(10);
  const issued = useQuery({ queryKey: ['vouchers', codes?.id], enabled: !!codes, queryFn: () => api<{ items: { id: number; code: string; status: string }[]; total: number }>(`/voucher-campaigns/${codes!.id}/vouchers`, { query: { pageSize: 100 } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['voucher-campaigns'] }); qc.invalidateQueries({ queryKey: ['vouchers'] }); };
  const run = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { refresh(); toast('Đã cập nhật'); }, onError: toastError });
  const columns: Column<Campaign>[] = [
    { key: 'code', header: 'Mã đợt' }, { key: 'name', header: 'Tên đợt phát hành' },
    { key: 'value', header: 'Mệnh giá', align: 'right', render: c => (c.unit === '%' ? `${c.value}%` : formatVnd(c.value)) },
    { key: 'minOrder', header: 'Đơn tối thiểu', money: true },
    { key: 'total', header: 'Đã phát hành', align: 'right' }, { key: 'used', header: 'Đã dùng', align: 'right' },
    { key: 'endAt', header: 'Hết hạn', render: c => (c.endAt ? formatDate(c.endAt) : '—') },
  ];
  function saveCampaign() {
    const { id, total: _t, used: _u, ...body } = form!;
    setForm(null);
    run.mutate(() => api(id ? `/voucher-campaigns/${id}` : '/voucher-campaigns', { method: id ? 'PUT' : 'POST', body: { name: '', value: 0, unit: 'VND', minOrder: 0, ...body } }));
  }
  return (
    <div className="space-y-3 p-4">
      {can('promotions.create') && <button type="button" className="btn-primary" onClick={() => setForm({ unit: 'VND', value: 50_000, minOrder: 0, multiUse: false, combinable: false, isActive: true })}>Tạo đợt phát hành voucher</button>}
      <div className="card overflow-hidden">
        <DataTable tableId="voucher-campaigns" columns={columns} rows={list.data ?? []} getRowId={c => c.id}
          renderExpanded={c => (
            <div className="flex justify-end gap-2 p-3">
              <button type="button" className="btn" onClick={() => download(`/voucher-campaigns/${c.id}/export`, undefined, `voucher-${c.code}.xlsx`)}>Xuất file</button>
              <button type="button" className="btn" onClick={() => setCodes(c)}>Danh sách mã</button>
              {can('promotions.edit') && <button type="button" className="btn-primary" onClick={() => setForm(c)}>Chỉnh sửa</button>}
            </div>
          )} />
      </div>
      <Modal open={!!form} title={form?.id ? 'Sửa đợt voucher' : 'Tạo đợt voucher'} onClose={() => setForm(null)} footer={<button type="button" className="btn-primary" disabled={!form?.name} onClick={saveCampaign}>Lưu</button>}>
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Tên đợt phát hành"><input className="input" value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Field></div>
            <Field label="Mệnh giá"><div className="flex gap-2"><NumberInput value={form.value ?? 0} onChange={v => setForm({ ...form, value: Math.max(0, Math.round(v)) })} /><select className="input w-24" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value as '%' | 'VND' })}><option>VND</option><option>%</option></select></div></Field>
            <Field label="Giảm tối đa (với %)"><MoneyInput value={form.maxDiscount ?? 0} onChange={v => setForm({ ...form, maxDiscount: v || null })} /></Field>
            <Field label="Đơn hàng tối thiểu"><MoneyInput value={form.minOrder ?? 0} onChange={v => setForm({ ...form, minOrder: v })} /></Field>
            <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={!!form.multiUse} onChange={e => setForm({ ...form, multiUse: e.target.checked })} />Dùng nhiều lần</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.combinable} onChange={e => setForm({ ...form, combinable: e.target.checked })} />Áp dụng cùng khuyến mại khác</label>
          </div>
        )}
      </Modal>
      <Modal open={!!codes} title={`Mã voucher: ${codes?.name ?? ''}`} onClose={() => setCodes(null)}
        footer={can('promotions.create') && <div className="flex items-center gap-2"><NumberInput className="w-24" value={count} onChange={v => setCount(Math.min(1000, Math.max(1, Math.round(v))))} /><button type="button" className="btn-primary" onClick={() => run.mutate(() => api(`/voucher-campaigns/${codes!.id}/generate`, { body: { count } }))}>Phát hành thêm</button></div>}>
        <div className="grid grid-cols-3 gap-1 font-mono text-sm sm:grid-cols-5">
          {issued.data?.items.map(v => <span key={v.id} className={v.status === 'used' ? 'text-slate-400 line-through' : ''}>{v.code}</span>)}
        </div>
        {issued.data && issued.data.total > 100 && <p className="mt-2 text-xs text-slate-500">Hiển thị 100/{issued.data.total} mã. Xuất file để xem tất cả.</p>}
      </Modal>
    </div>
  );
}

export function PromotionsPage() {
  return <Tabs className="bg-white" tabs={[{ key: 'promo', label: 'Khuyến mại', content: () => <Promotions /> }, { key: 'voucher', label: 'Voucher', content: () => <Vouchers /> }]} />;
}
