import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toastError, toast } from '../../components/toast';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { DocumentLinesEditor, type DocLine } from '../../components/docs/DocumentLinesEditor';
import {
  CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination, RadioFilter,
  resolveDateRange, useListState, type Column,
} from '../../components/list';
import { STOCK_DOCS, type StockDocKind } from './configs';

type DocRow = { id: number; code: string; status: string; createdAt: string; note: string; branchName?: string; createdByName?: string } & Record<string, unknown>;
type DocDetail = DocRow & { lines: (DocLine & Record<string, unknown>)[] };

function DocExpanded({ kind, id }: { kind: StockDocKind; id: number }) {
  const cfg = STOCK_DOCS[kind];
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: [cfg.api, id], queryFn: () => api<DocDetail>(`${cfg.api}/${id}`) });
  if (!d.data) return <div className="p-4 text-slate-400">Đang tải...</div>;
  const doc = d.data;
  const lines = doc.lines.map(l => ({ ...l, code: String(l.productCode), name: String(l.productName), unit: String(l.unit ?? '') }));
  const act = (path: string) => api(`${cfg.api}/${id}/${path}`, { body: {} }).then(() => { qc.invalidateQueries({ queryKey: [cfg.api] }); toast('Đã cập nhật'); }, toastError);
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
        <div><span className="text-slate-500">Mã phiếu: </span><b>{doc.code}</b></div>
        <div><span className="text-slate-500">Trạng thái: </span><DocStatusBadge status={doc.status} /></div>
        <div><span className="text-slate-500">Người tạo: </span>{doc.createdByName}</div>
        <div><span className="text-slate-500">Ngày tạo: </span>{formatDateTime(doc.createdAt)}</div>
        {kind === 'transfer' && <><div><span className="text-slate-500">Từ: </span>{String(doc.fromBranchName)}</div><div><span className="text-slate-500">Tới: </span>{String(doc.toBranchName)}</div></>}
        {doc.reason ? <div className="col-span-2"><span className="text-slate-500">Lý do: </span>{String(doc.reason)}</div> : null}
        {doc.note && <div className="col-span-2"><span className="text-slate-500">Ghi chú: </span>{doc.note}</div>}
      </div>
      <div className="max-h-80 overflow-auto rounded border border-slate-200">
        <DocumentLinesEditor readOnly lines={lines} onChange={() => undefined} qtyKey={cfg.qtyKey} columns={cfg.lineColumns('view')} newLine={() => ({})} />
      </div>
      <div className="flex justify-end gap-2">
        {doc.status === 'draft' && can(`${cfg.perm}.edit`) && <button type="button" className="btn-primary" onClick={() => navigate({ to: `${cfg.route}/${id}` })}>Mở phiếu</button>}
        {kind === 'transfer' && doc.status === 'inTransit' && <button type="button" className="btn-primary" onClick={() => navigate({ to: `${cfg.route}/${id}` })}>Nhận hàng</button>}
        {doc.status !== 'cancelled' && !(kind === 'transfer' && doc.status === 'received') && can(`${cfg.perm}.delete`) && <button type="button" className="btn text-rose-600" onClick={() => act('cancel')}>Hủy phiếu</button>}
      </div>
    </div>
  );
}

export function makeStockDocListPage(kind: StockDocKind) {
  return function StockDocListPage() {
    const cfg = STOCK_DOCS[kind];
    const { can } = useAuth();
    const navigate = useNavigate();
    const { state, set } = useListState({ date: 'thisMonth', status: cfg.statuses.filter(s => s.value !== 'cancelled').map(s => s.value), direction: '' });
    const range = resolveDateRange(state.date as string);
    const query = { page: state.page, pageSize: state.pageSize, search: state.search, status: state.status as string[], kind: cfg.issueKind, direction: (state.direction as string) || undefined, ...range };
    const list = useQuery({ queryKey: [cfg.api, 'list', query], queryFn: () => api<{ items: DocRow[]; total: number; totals: Record<string, number> }>(cfg.api, { query }) });
    const columns: Column<DocRow>[] = [
      { key: 'code', header: `Mã ${cfg.title.toLowerCase()}` },
      { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt) },
      ...cfg.listColumns.map(c => ({ ...c, render: c.key.endsWith('At') ? (r: DocRow) => (r[c.key] ? formatDateTime(String(r[c.key])) : '') : undefined })),
      { key: 'note', header: 'Ghi chú', hiddenByDefault: true },
      { key: 'status', header: 'Trạng thái', render: r => <DocStatusBadge status={r.status} /> },
    ];
    return (
      <ListPage
        sidebar={
          <FilterSidebar title={cfg.title}>
            <FilterSection title="Trạng thái"><CheckboxFilter options={cfg.statuses} value={state.status as string[]} onChange={v => set({ status: v })} /></FilterSection>
            {kind === 'transfer' && (
              <FilterSection title="Loại phiếu"><RadioFilter options={[{ value: '', label: 'Tất cả' }, { value: 'out', label: 'Chuyển đi' }, { value: 'in', label: 'Nhận về' }]} value={state.direction as string} onChange={v => set({ direction: v })} /></FilterSection>
            )}
            <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} /></FilterSection>
          </FilterSidebar>
        }
        toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã phiếu"
          onCreate={can(`${cfg.perm}.create`) ? () => navigate({ to: `${cfg.route}/new` }) : undefined} createLabel={cfg.newTitle}
          onExport={() => download(`${cfg.api}/export`, query, cfg.exportName)} />}
        footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="phiếu" onChange={(page, pageSize) => set({ page, pageSize })} />}
      >
        <DataTable tableId={`docs-${kind}`} columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} totals={list.data?.totals} loading={list.isLoading}
          renderExpanded={r => <DocExpanded kind={kind} id={r.id} />} />
      </ListPage>
    );
  };
}
