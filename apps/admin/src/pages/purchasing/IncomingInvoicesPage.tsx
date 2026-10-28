import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput } from '../../components/Field';
import { ImportFileDialog } from '../../components/ImportFileDialog';
import { DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter, resolveDateRange, useListState, type Column } from '../../components/list';

type Inv = { id: number; series: string; invoiceNo: string; issuedAt: string; supplierName: string; supplierTaxCode: string; subtotal: number; vatAmount: number; total: number; receiptId: number | null; receiptCode: string | null; purchaseOrderCode: string | null; note: string };
type Draft = Omit<Inv, 'id' | 'receiptId' | 'receiptCode' | 'purchaseOrderCode'> & { id?: number };
const blank: Draft = { series: '', invoiceNo: '', issuedAt: new Date().toISOString(), supplierName: '', supplierTaxCode: '', subtotal: 0, vatAmount: 0, total: 0, note: '' };

export function IncomingInvoicesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { state, set } = useListState({ date: 'thisMonth', linked: '' });
  const range = resolveDateRange(state.date as string);
  const query = { page: state.page, pageSize: state.pageSize, search: state.search, linked: (state.linked as string) || undefined, ...range };
  const list = useQuery({ queryKey: ['incoming-invoices', query], queryFn: () => api<{ items: Inv[]; total: number; totals: Record<string, number> }>('/incoming-invoices', { query }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [linking, setLinking] = useState<Inv | null>(null);
  const [receiptCode, setReceiptCode] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['incoming-invoices'] });
  const save = useMutation({
    mutationFn: (d: Draft) => { const { id, ...body } = d; return api(id ? `/incoming-invoices/${id}` : '/incoming-invoices', { method: id ? 'PUT' : 'POST', body }); },
    onSuccess: () => { refresh(); setDraft(null); toast('Đã lưu hóa đơn'); }, onError: toastError,
  });
  async function link() {
    try {
      const found = await api<{ items: { id: number; code: string }[] }>('/purchase-receipts', { query: { search: receiptCode.trim(), pageSize: 15 } });
      const r = found.items.find(x => x.code === receiptCode.trim().toUpperCase());
      if (!r) throw new Error(`Không tìm thấy phiếu nhập ${receiptCode}`);
      await api(`/incoming-invoices/${linking!.id}/link`, { body: { receiptId: r.id } });
      refresh(); setLinking(null); toast('Đã liên kết');
    } catch (e) { toastError(e); }
  }
  const columns: Column<Inv>[] = [
    { key: 'series', header: 'Ký hiệu' }, { key: 'invoiceNo', header: 'Số hóa đơn' }, { key: 'issuedAt', header: 'Ngày hóa đơn', render: r => formatDate(r.issuedAt) },
    { key: 'supplierName', header: 'Người bán' }, { key: 'supplierTaxCode', header: 'MST' },
    { key: 'subtotal', header: 'Tiền hàng', money: true, total: true }, { key: 'vatAmount', header: 'Tiền thuế', money: true, total: true }, { key: 'total', header: 'Tổng tiền', money: true, total: true },
    { key: 'receiptCode', header: 'Phiếu nhập', render: r => r.receiptCode ?? r.purchaseOrderCode ?? <span className="text-amber-700">Chưa liên kết</span> },
  ];
  const num = (k: 'subtotal' | 'vatAmount' | 'total', label: string) => <Field label={label}><MoneyInput value={draft![k]} onChange={v => setDraft({ ...draft!, [k]: v, ...(k !== 'total' ? { total: (k === 'subtotal' ? v : draft!.subtotal) + (k === 'vatAmount' ? v : draft!.vatAmount) } : {}) })} /></Field>;
  return (
    <>
      <ListPage
        sidebar={<FilterSidebar title="Hóa đơn đầu vào">
          <FilterSection title="Ngày hóa đơn"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['thisMonth', 'lastMonth', 'thisQuarter', 'all']} /></FilterSection>
          <FilterSection title="Liên kết"><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'true', label: 'Đã liên kết' }, { value: 'false', label: 'Chưa liên kết' }]} value={state.linked as string} onChange={v => set({ linked: v })} /></FilterSection>
        </FilterSidebar>}
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo số hóa đơn"
          onCreate={can('incomingInvoices.create') ? () => setDraft({ ...blank }) : undefined} createLabel="Hóa đơn"
          onImport={can('incomingInvoices.create') ? () => setImportOpen(true) : undefined} onExport={() => download('/incoming-invoices/export', query, 'hoa-don-dau-vao.xlsx')} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="hóa đơn" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId="incoming-invoices" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => (
            <div className="flex justify-end gap-2 p-3">
              {can('incomingInvoices.edit') && <button type="button" className="btn" onClick={() => { setReceiptCode(r.receiptCode ?? ''); setLinking(r); }}>Liên kết phiếu nhập</button>}
              {can('incomingInvoices.edit') && <button type="button" className="btn-primary" onClick={() => setDraft({ ...r })}>Chỉnh sửa</button>}
            </div>
          )} />
      </ListPage>
      <Modal open={!!draft} title={draft?.id ? 'Sửa hóa đơn đầu vào' : 'Thêm hóa đơn đầu vào'} onClose={() => setDraft(null)}
        footer={<button type="button" className="btn-primary" onClick={() => draft && save.mutate(draft)}>Lưu</button>}>
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ký hiệu"><input className="input" value={draft.series} onChange={e => setDraft({ ...draft, series: e.target.value })} /></Field>
            <Field label="Số hóa đơn"><input className="input" value={draft.invoiceNo} onChange={e => setDraft({ ...draft, invoiceNo: e.target.value })} /></Field>
            <Field label="Ngày hóa đơn"><input type="date" className="input" value={new Date(new Date(draft.issuedAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10)} onChange={e => e.target.value && setDraft({ ...draft, issuedAt: new Date(`${e.target.value}T00:00:00+07:00`).toISOString() })} /></Field>
            <Field label="MST người bán"><input className="input" value={draft.supplierTaxCode} onChange={e => setDraft({ ...draft, supplierTaxCode: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Tên người bán"><input className="input" value={draft.supplierName} onChange={e => setDraft({ ...draft, supplierName: e.target.value })} /></Field></div>
            {num('subtotal', 'Tiền hàng')}{num('vatAmount', 'Tiền thuế')}{num('total', 'Tổng tiền')}
            <Field label="Ghi chú"><input className="input" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!linking} size="sm" title={`Liên kết hóa đơn ${linking?.invoiceNo ?? ''}`} onClose={() => setLinking(null)} footer={<button type="button" className="btn-primary" onClick={link}>Lưu</button>}>
        <Field label="Mã phiếu nhập hàng"><input className="input" placeholder="VD: PN000012" value={receiptCode} onChange={e => setReceiptCode(e.target.value)} /></Field>
      </Modal>
      <ImportFileDialog open={importOpen} onClose={() => setImportOpen(false)} title="Nhập hóa đơn đầu vào từ file" templatePath="/incoming-invoices/import-template" templateName="mau-hoa-don-dau-vao.xlsx" importPath="/incoming-invoices/import" onDone={refresh} />
    </>
  );
}
