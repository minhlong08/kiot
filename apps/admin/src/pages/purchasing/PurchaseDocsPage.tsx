import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast, toastError } from '../../components/toast';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import {
  CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination,
  resolveDateRange, useListState, type Column,
} from '../../components/list';

type Kind = 'receipt' | 'order' | 'return';
type Row = { id: number; code: string; createdAt: string; supplierCode: string; supplierName: string; status: string; total: number; paid?: number; debt?: number; refund?: number; note: string } & Record<string, unknown>;
type Line = { id: number; productCode: string; productName: string; unit: string; qty: number; unitCost?: number; price?: number; discount?: number; amount?: number; receivedQty?: number };

const CFG = {
  receipt: {
    title: 'Nhập hàng', api: '/purchase-receipts', route: '/purchase-receipts', perm: 'purchaseReceipts', createLabel: 'Nhập hàng', exportName: 'nhap-hang.xlsx',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'completed', label: 'Đã nhập hàng' }, { value: 'cancelled', label: 'Đã hủy' }],
    columns: [{ key: 'total', header: 'Cần trả NCC', money: true, total: true }, { key: 'paid', header: 'Đã trả NCC', money: true, total: true }, { key: 'debt', header: 'Còn nợ', money: true, total: true }],
  },
  order: {
    title: 'Đặt hàng nhập', api: '/purchase-orders', route: '/purchase-orders', perm: 'purchaseOrders', createLabel: 'Đặt hàng nhập', exportName: 'dat-hang-nhap.xlsx',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'confirmed', label: 'Đã xác nhận' }, { value: 'partial', label: 'Nhập một phần' }, { value: 'completed', label: 'Hoàn thành' }, { value: 'cancelled', label: 'Đã hủy' }],
    columns: [{ key: 'total', header: 'Tổng tiền', money: true, total: true }],
  },
  return: {
    title: 'Trả hàng nhập', api: '/purchase-returns', route: '/purchase-returns', perm: 'purchaseReturns', createLabel: 'Trả hàng nhập', exportName: 'tra-hang-nhap.xlsx',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'completed', label: 'Đã trả hàng' }, { value: 'cancelled', label: 'Đã hủy' }],
    columns: [{ key: 'total', header: 'NCC cần trả', money: true, total: true }, { key: 'refund', header: 'NCC đã trả', money: true, total: true }],
  },
} as const;

function Expanded({ kind, row }: { kind: Kind; row: Row }) {
  const cfg = CFG[kind];
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: [cfg.api.slice(1), row.id], queryFn: () => api<Row & { lines: Line[]; payments?: { code: string; amount: number; status: string }[]; invoices?: { invoiceNo: string }[]; purchaseOrderCode?: string | null; receiptCode?: string | null }>(`${cfg.api}/${row.id}`) });
  const act = (path: string) => api(`${cfg.api}/${row.id}/${path}`, { body: {} }).then(() => { qc.invalidateQueries({ queryKey: [cfg.api.slice(1)] }); qc.invalidateQueries({ queryKey: ['products'] }); toast('Đã cập nhật'); }, toastError);
  if (!d.data) return <div className="p-4 text-slate-400">Đang tải...</div>;
  const doc = d.data;
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
        <div><span className="text-slate-500">Mã phiếu: </span><b>{doc.code}</b></div>
        <div><span className="text-slate-500">Nhà cung cấp: </span>{doc.supplierName}</div>
        <div><span className="text-slate-500">Trạng thái: </span><DocStatusBadge status={doc.status} /></div>
        <div><span className="text-slate-500">Thời gian: </span>{formatDateTime(doc.createdAt)}</div>
        {doc.purchaseOrderCode && <div><span className="text-slate-500">Đặt hàng nhập: </span>{doc.purchaseOrderCode}</div>}
        {doc.receiptCode && <div><span className="text-slate-500">Phiếu nhập: </span>{doc.receiptCode}</div>}
        {!!doc.invoices?.length && <div><span className="text-slate-500">HĐ đầu vào: </span>{doc.invoices.map(i => i.invoiceNo).join(', ')}</div>}
        {doc.note && <div className="col-span-2"><span className="text-slate-500">Ghi chú: </span>{doc.note}</div>}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1.5 text-left">Mã hàng</th><th className="text-left">Tên hàng</th><th className="text-left">ĐVT</th><th className="text-right">Số lượng</th>{kind === 'order' && <th className="text-right">Đã nhập</th>}<th className="text-right">{kind === 'return' ? 'Giá trả' : 'Đơn giá'}</th>{kind !== 'return' && <th className="text-right">Giảm giá</th>}<th className="px-2 text-right">Thành tiền</th></tr></thead>
        <tbody>
          {doc.lines.map(l => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="px-2 py-1.5">{l.productCode}</td><td>{l.productName}</td><td>{l.unit}</td><td className="num">{formatVnd(l.qty)}</td>
              {kind === 'order' && <td className="num">{formatVnd(l.receivedQty ?? 0)}</td>}
              <td className="num">{formatVnd(l.unitCost ?? l.price ?? 0)}</td>{kind !== 'return' && <td className="num">{formatVnd(l.discount ?? 0)}</td>}
              <td className="num px-2">{formatVnd(kind === 'return' ? (l.amount ?? 0) : l.qty * (l.unitCost ?? 0) - (l.discount ?? 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><span>Tổng tiền hàng</span><span>{formatVnd(Number(doc.subtotal ?? 0))}</span></div>
        <div className="flex justify-between"><span>Giảm giá</span><span>{formatVnd(Number(doc.discount ?? 0))}</span></div>
        {kind === 'receipt' && <div className="flex justify-between"><span>Chi phí nhập khác</span><span>{formatVnd(Number(doc.otherCosts ?? 0))}</span></div>}
        <div className="flex justify-between font-semibold"><span>{kind === 'return' ? 'NCC cần trả' : 'Cần trả NCC'}</span><span>{formatVnd(doc.total)}</span></div>
        {kind === 'receipt' && <div className="flex justify-between"><span>Đã trả NCC</span><span>{formatVnd(doc.paid ?? 0)}</span></div>}
        {kind === 'return' && <div className="flex justify-between"><span>NCC đã trả</span><span>{formatVnd(doc.refund ?? 0)}</span></div>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {(doc.status === 'draft' || (kind === 'order' && doc.status === 'confirmed' && !doc.lines.some(l => (l.receivedQty ?? 0) > 0))) && can(`${cfg.perm}.edit`) && <button type="button" className="btn-primary" onClick={() => navigate({ to: `${cfg.route}/${row.id}` })}>Mở phiếu</button>}
        {kind === 'order' && ['confirmed', 'partial'].includes(doc.status) && can('purchaseReceipts.create') && <button type="button" className="btn-primary" onClick={() => window.location.assign(`/purchase-receipts/new?fromOrder=${row.id}`)}>Tạo phiếu nhập</button>}
        {kind === 'order' && doc.status === 'partial' && can('purchaseOrders.edit') && <button type="button" className="btn" onClick={() => act('close')}>Kết thúc</button>}
        {kind === 'receipt' && doc.status === 'completed' && can('purchaseReturns.create') && <button type="button" className="btn" onClick={() => window.location.assign(`/purchase-returns/new?fromReceipt=${row.id}`)}>Trả hàng nhập</button>}
        {doc.status !== 'cancelled' && !(kind === 'order' && doc.status === 'completed') && can(`${cfg.perm}.delete`) && <button type="button" className="btn text-rose-600" onClick={() => act('cancel')}>Hủy phiếu</button>}
      </div>
    </div>
  );
}

export function makePurchaseDocsPage(kind: Kind) {
  return function PurchaseDocsPage() {
    const cfg = CFG[kind];
    const { can } = useAuth();
    const navigate = useNavigate();
    const { state, set } = useListState({ date: 'thisMonth', status: cfg.statuses.filter(s => s.value !== 'cancelled').map(s => s.value as string), invoiceNo: '' });
    const range = resolveDateRange(state.date as string);
    const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], invoiceNo: (state.invoiceNo as string) || undefined, ...range };
    const list = useQuery({ queryKey: [cfg.api.slice(1), 'list', query], queryFn: () => api<{ items: Row[]; total: number; totals: Record<string, number> }>(cfg.api, { query }) });
    const columns: Column<Row>[] = [
      { key: 'code', header: `Mã ${cfg.title.toLowerCase()}` },
      { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
      { key: 'supplierCode', header: 'Mã NCC' },
      { key: 'supplierName', header: 'Nhà cung cấp' },
      ...cfg.columns,
      { key: 'status', header: 'Trạng thái', render: r => <DocStatusBadge status={r.status} /> },
    ];
    return (
      <ListPage
        sidebar={
          <FilterSidebar title={cfg.title}>
            <FilterSection title="Trạng thái"><CheckboxFilter options={[...cfg.statuses]} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
            <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
            {kind === 'receipt' && <FilterSection title="Số hóa đơn đầu vào"><input className="input" placeholder="Theo số hóa đơn đầu vào" value={state.invoiceNo as string} onChange={e => set({ invoiceNo: e.target.value })} /></FilterSection>}
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã phiếu"
          onCreate={can(`${cfg.perm}.create`) ? () => navigate({ to: `${cfg.route}/new` }) : undefined} createLabel={cfg.createLabel}
          onExport={kind !== 'order' ? () => download(`${cfg.api}/export`, query, cfg.exportName) : undefined} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId={`purchase-${kind}`} columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => <Expanded kind={kind} row={r} />} />
      </ListPage>
    );
  };
}
