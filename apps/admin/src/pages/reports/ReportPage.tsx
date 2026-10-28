import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, Printer, Table2 } from 'lucide-react';
import clsx from 'clsx';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DateRangeFilter, FilterSection, FilterSidebar, resolveDateRange, useListState } from '../../components/list';
import { BarChart, HBarChart, LineChart } from '../../components/charts';
import { toastError } from '../../components/toast';

type Column = { key: string; label: string; money?: boolean; number?: boolean; percent?: boolean };
type Report = { title: string; columns: Column[]; rows: Record<string, unknown>[]; totals: Record<string, number>; chart?: { type: 'bar' | 'hbar' | 'line'; labels: string[]; series: { name: string; values: number[] }[] } };
type Param = 'range' | 'by' | 'date' | 'year' | 'role' | 'staff' | 'channel' | 'group';
export type ReportDef = { name: string; label: string; params: Param[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;
function cell(c: Column, v: unknown) {
  if (v === null || v === undefined || v === '') return '';
  if (c.percent) return `${v}%`;
  if (c.money || c.number) return formatVnd(Number(v));
  if (typeof v === 'string' && ISO_DATE.test(v)) return formatDateTime(v);
  return String(v);
}
function printTable(r: Report, subtitle: string) {
  const esc = (t: string) => t.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
  const head = r.columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  const body = r.rows.map(row => `<tr>${r.columns.map(c => `<td class="${c.money || c.number ? 'n' : ''}">${esc(cell(c, row[c.key]))}</td>`).join('')}</tr>`).join('');
  const total = Object.keys(r.totals).length ? `<tr class="t">${r.columns.map((c, i) => `<td class="n">${i === 0 ? 'Tổng cộng' : esc(cell(c, r.totals[c.key]))}</td>`).join('')}</tr>` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:10mm}body{font-family:system-ui;font-size:11px}h1{font-size:16px;margin:0}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border:1px solid #bbb;padding:3px 5px}.n{text-align:right}.t td{font-weight:bold;background:#f1f5f9}</style></head><body><h1>${esc(r.title)}</h1><div>${esc(subtitle)}</div><table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table></body></html>`;
  const f = document.createElement('iframe');
  // No allow-scripts: printed HTML (store templates, customer data) can never run code in the app's origin.
  f.setAttribute('sandbox', 'allow-same-origin allow-modals');
  Object.assign(f.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(f);
  f.contentDocument!.open(); f.contentDocument!.write(html); f.contentDocument!.close();
  setTimeout(() => { f.contentWindow?.print(); setTimeout(() => f.remove(), 1500); }, 250);
}

/** One screen for a family of reports: tabs, filters, table/chart, print, export. */
export function ReportPage({ title, reports }: { title: string; reports: ReportDef[] }) {
  const { can, me } = useAuth();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const { state, set } = useListState({ report: reports[0].name, date: 'thisMonth', by: 'day', day: today, year: today.slice(0, 4), branch: '', role: 'seller', seller: '', channel: '', group: '' });
  const def = reports.find(r => r.name === state.report) ?? reports[0];
  const has = (p: Param) => def.params.includes(p);
  const lookups = {
    channels: useQuery({ queryKey: ['sales-channels'], enabled: has('channel'), queryFn: () => api<{ code: string; name: string }[]>('/sales-channels') }),
    groups: useQuery({ queryKey: ['product-groups'], enabled: has('group'), queryFn: () => api<{ id: number; name: string }[]>('/product-groups') }),
    users: useQuery({ queryKey: ['users', 'report-filter'], enabled: has('staff'), queryFn: () => api<{ items: { id: number; fullName: string }[] }>('/users', { query: { pageSize: 100 } }).catch(() => ({ items: [] })) }),
    branches: useQuery({ queryKey: ['branches'], enabled: !!me?.user.isAdmin, queryFn: () => api<{ items: { id: number; name: string }[] }>('/branches', { query: { pageSize: 100 } }) }),
  };
  const branchOptions = me?.user.isAdmin ? lookups.branches.data?.items ?? [] : (me as { branches?: { id: number; name: string }[] } | null)?.branches ?? [];
  const [view, setView] = useState<'table' | 'chart'>('table');
  const query: Record<string, string | undefined> = {
    ...(def.params.includes('range') ? resolveDateRange(state.date as string) : {}),
    ...(def.params.includes('by') ? { by: state.by as string } : {}), ...(def.params.includes('date') ? { date: state.day as string } : {}),
    ...(def.params.includes('year') ? { year: state.year as string } : {}), ...(def.params.includes('role') ? { role: state.role as string } : {}),
    ...(def.params.includes('staff') && state.seller ? { sellerIds: state.seller as string } : {}),
    ...(def.params.includes('channel') && state.channel ? { channels: state.channel as string } : {}),
    ...(def.params.includes('group') && state.group ? { groupIds: state.group as string } : {}),
    ...(state.branch ? { branchId: state.branch as string } : {}),
  };
  const q = useQuery({ queryKey: ['report', def.name, query], queryFn: () => api<Report>(`/reports/${def.name}`, { query }) });
  const r = q.data;
  const subtitle = [query.from && `Từ ${formatDateTime(query.from)}`, query.to && `đến ${formatDateTime(query.to)}`, query.date && `Ngày ${String(query.date).split('-').reverse().join('/')}`, query.year && `Năm ${query.year}`].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-4 p-4 lg:flex-row">
      <FilterSidebar title={title}>
        {def.params.includes('range') && <FilterSection title="Thời gian"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear']} /></FilterSection>}
        {def.params.includes('date') && <FilterSection title="Ngày"><input type="date" className="input" aria-label="Ngày" value={state.day as string} onChange={e => set({ day: e.target.value })} /></FilterSection>}
        {def.params.includes('year') && <FilterSection title="Năm"><select className="input" aria-label="Năm" value={state.year as string} onChange={e => set({ year: e.target.value })}>{Array.from({ length: 5 }, (_, i) => String(Number(today.slice(0, 4)) - i)).map(y => <option key={y}>{y}</option>)}</select></FilterSection>}
        {def.params.includes('by') && <FilterSection title="Xem theo"><select className="input" aria-label="Xem theo" value={state.by as string} onChange={e => set({ by: e.target.value })}><option value="day">Ngày</option><option value="hour">Giờ trong ngày</option><option value="weekday">Thứ trong tuần</option><option value="month">Tháng</option></select></FilterSection>}
        {def.params.includes('role') && <FilterSection title="Nhân viên"><select className="input" aria-label="Theo" value={state.role as string} onChange={e => set({ role: e.target.value })}><option value="seller">Người bán</option><option value="creator">Người tạo</option></select></FilterSection>}
        {def.params.includes('staff') && <FilterSection title="Nhân viên bán"><select className="input" aria-label="Nhân viên bán" value={state.seller as string} onChange={e => set({ seller: e.target.value })}><option value="">Tất cả</option>{lookups.users.data?.items.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></FilterSection>}
        {def.params.includes('channel') && <FilterSection title="Kênh bán"><select className="input" aria-label="Kênh bán" value={state.channel as string} onChange={e => set({ channel: e.target.value })}><option value="">Tất cả</option>{lookups.channels.data?.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></FilterSection>}
        {def.params.includes('group') && <FilterSection title="Nhóm hàng"><select className="input" aria-label="Nhóm hàng" value={state.group as string} onChange={e => set({ group: e.target.value })}><option value="">Tất cả</option>{lookups.groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></FilterSection>}
        {branchOptions.length > 1 && <FilterSection title="Chi nhánh"><select className="input" aria-label="Chi nhánh" value={state.branch as string} onChange={e => set({ branch: e.target.value })}>
          <option value="">Chi nhánh đang làm việc</option>{me?.user.isAdmin && <option value="all">Tất cả chi nhánh</option>}{branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></FilterSection>}
      </FilterSidebar>
      <section className="min-w-0 flex-1 space-y-3">
        {reports.length > 1 && (
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200">
            {reports.map(x => <button key={x.name} role="tab" aria-selected={x.name === def.name} type="button" onClick={() => { set({ report: x.name }); setView('table'); }} className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', x.name === def.name ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500')}>{x.label}</button>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-lg font-semibold">{r?.title ?? def.label}<span className="ml-2 text-sm font-normal text-slate-500">{subtitle}</span></h1>
          {r?.chart && <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
            <button type="button" onClick={() => setView('table')} className={clsx('flex items-center gap-1 rounded-md px-2 py-1', view === 'table' && 'bg-white shadow-sm')}><Table2 size={14} />Bảng</button>
            <button type="button" onClick={() => setView('chart')} className={clsx('flex items-center gap-1 rounded-md px-2 py-1', view === 'chart' && 'bg-white shadow-sm')}><BarChart3 size={14} />Biểu đồ</button>
          </div>}
          <button type="button" className="btn" disabled={!r} onClick={() => r && printTable(r, subtitle)}><Printer size={16} />In</button>
          {can('reports.export') && <button type="button" className="btn" onClick={() => download(`/reports/${def.name}/export`, query, `${def.name}.xlsx`).catch(toastError)}><Download size={16} />Xuất file</button>}
        </div>
        {q.isError && <div className="card p-6 text-center text-rose-600">{(q.error as Error).message}</div>}
        {r && view === 'chart' && r.chart && (
          <div className="card p-4">
            {r.chart.type === 'hbar' ? <HBarChart rows={r.chart.labels.map((l, i) => ({ label: l, value: r.chart!.series[0]?.values[i] ?? 0 })).slice(0, 20)} /> : r.chart.type === 'line' ? <LineChart labels={r.chart.labels} series={r.chart.series} /> : <BarChart labels={r.chart.labels} series={r.chart.series} />}
          </div>
        )}
        {r && view === 'table' && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600"><tr>{r.columns.map(c => <th key={c.key} className={clsx('whitespace-nowrap p-2 font-medium', c.money || c.number || c.percent ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr></thead>
              <tbody>
                {Object.keys(r.totals).length > 0 && r.rows.length > 0 && <tr className="bg-amber-50/60 font-semibold">{r.columns.map((c, i) => <td key={c.key} className={clsx('p-2', c.money || c.number || c.percent ? 'text-right tabular-nums' : '')}>{i === 0 ? 'Tổng cộng' : cell(c, r.totals[c.key])}</td>)}</tr>}
                {r.rows.map((row, i) => <tr key={i} className="border-t border-slate-100">{r.columns.map(c => <td key={c.key} className={clsx('p-2', c.money || c.number || c.percent ? 'text-right tabular-nums' : '')}>{cell(c, row[c.key])}</td>)}</tr>)}
                {!r.rows.length && <tr><td colSpan={r.columns.length} className="p-8 text-center text-slate-400">Không có dữ liệu trong kỳ</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
