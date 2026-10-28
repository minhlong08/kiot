import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@pd/shared';
import { api, download } from '../../lib/api';
import { ACTION_LABELS, ENTITY_LABELS } from '../../lib/labels';
import { t } from '../../lib/i18n';
import {
  CheckboxFilter, DataTable, DateRangeFilter, FilterSection, FilterSidebar, ListPage, ListToolbar, Pagination,
  resolveDateRange, useListState, type Column,
} from '../../components/list';

type Row = { id: number; createdAt: string; userName: string; entity: string; action: string; entityCode: string; summary: string; diff: string };

const columns: Column<Row>[] = [
  { key: 'createdAt', header: 'Thời gian', render: r => formatDateTime(r.createdAt), width: 150 },
  { key: 'userName', header: 'Người thực hiện' },
  { key: 'entity', header: 'Chức năng', render: r => ENTITY_LABELS[r.entity] ?? r.entity },
  { key: 'action', header: 'Thao tác', render: r => ACTION_LABELS[r.action] ?? r.action },
  { key: 'entityCode', header: 'Mã' },
  { key: 'summary', header: 'Nội dung' },
];

function DiffView({ diff }: { diff: string }) {
  let parsed: Record<string, [unknown, unknown]> = {};
  try { parsed = JSON.parse(diff); } catch { /* ignore */ }
  const entries = Object.entries(parsed);
  if (!entries.length) return <p className="p-4 text-sm text-slate-500">Không có thay đổi chi tiết.</p>;
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table className="m-4 w-[calc(100%-2rem)] text-sm">
      <thead><tr className="text-left text-slate-500"><th className="py-1">Trường</th><th>Trước</th><th>Sau</th></tr></thead>
      <tbody>
        {entries.map(([k, [a, b]]) => (
          <tr key={k} className="border-t border-slate-100 align-top">
            <td className="py-1 pr-4 font-medium">{k}</td>
            <td className="max-w-md break-all pr-4 text-rose-700">{show(a)}</td>
            <td className="max-w-md break-all text-emerald-700">{show(b)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditLogPage() {
  const { state, set, query } = useListState({ date: 'thisMonth', entity: [] as string[], action: [] as string[] });
  const range = resolveDateRange(state.date as string);
  const apiQuery = { page: query.page, pageSize: query.pageSize, search: query.search as string, entity: state.entity as string[], action: state.action as string[], ...range };
  const entities = useQuery({ queryKey: ['audit-entities'], queryFn: () => api<string[]>('/audit-logs/entities') });
  const list = useQuery({ queryKey: ['audit-logs', apiQuery], queryFn: () => api<{ items: Row[]; total: number }>('/audit-logs', { query: apiQuery }) });

  return (
    <ListPage
      sidebar={
        <FilterSidebar title={t('settings.auditLog')}>
          <FilterSection title={t('common.time')}>
            <DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'thisWeek', 'thisMonth', 'lastMonth', 'all']} />
          </FilterSection>
          <FilterSection title="Chức năng">
            <CheckboxFilter options={(entities.data ?? []).map(e => ({ value: e, label: ENTITY_LABELS[e] ?? e }))} value={state.entity as string[]} onChange={v => set({ entity: v })} />
          </FilterSection>
          <FilterSection title="Thao tác" defaultOpen={false}>
            <CheckboxFilter options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))} value={state.action as string[]} onChange={v => set({ action: v })} />
          </FilterSection>
        </FilterSidebar>
      }
      toolbar={<ListToolbar search={state.search} onSearch={v => set({ search: v })} placeholder="Theo mã, nội dung" onExport={() => download('/audit-logs/export', apiQuery, 'lich-su-thao-tac.xlsx')} />}
      footer={<Pagination page={state.page} pageSize={state.pageSize} total={list.data?.total ?? 0} noun="thao tác" onChange={(page, pageSize) => set({ page, pageSize })} />}
    >
      <DataTable tableId="audit" columns={columns} rows={list.data?.items ?? []} getRowId={r => r.id} loading={list.isLoading} renderExpanded={r => <DiffView diff={r.diff} />} />
    </ListPage>
  );
}
