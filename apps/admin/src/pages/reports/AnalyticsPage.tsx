import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { DateRangeFilter, resolveDateRange, useListState } from '../../components/list';
import { BarChart, HBarChart, LineChart } from '../../components/charts';

type Kpi = { key: string; label: string; value: number; previous: number; change: number | null; money: boolean };
type Ranked = { name: string; value: number };
const bars = (xs: unknown) => (xs as Ranked[]).map(x => ({ label: x.name, value: x.value }));
type ChartData = { labels: string[]; series: { name: string; values: number[] }[] };
const TITLES = { business: 'Phân tích kinh doanh', products: 'Phân tích hàng hóa', customers: 'Phân tích khách hàng', efficiency: 'Phân tích hiệu quả' } as const;
type Name = keyof typeof TITLES;

const Card = ({ title, children, className }: { title: string; children: ReactNode; className?: string }) => <section className={clsx('card p-4', className)}><h2 className="mb-3 font-semibold">{title}</h2>{children}</section>;
function Kpis({ items, compare }: { items: Kpi[]; compare: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(k => (
        <div key={k.key} className="card p-3">
          <div className="text-xs text-slate-500">{k.label}</div>
          <div className="text-xl font-semibold tabular-nums">{formatVnd(k.value)}</div>
          {compare && <div className="flex items-center gap-2 text-xs text-slate-500">
            {k.change !== null && <span className={clsx('inline-flex items-center font-medium', k.change >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{k.change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(k.change)}%</span>}
            <span>kỳ trước {formatVnd(k.previous)}</span>
          </div>}
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage({ name }: { name: Name }) {
  const { state, set } = useListState({ date: 'thisMonth' });
  const range = resolveDateRange(state.date as string);
  const q = useQuery({ queryKey: ['analytics', name, range], queryFn: () => api<Record<string, unknown>>(`/analytics/${name}`, { query: range }) });
  const d = q.data as Record<string, never> | undefined;
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-xl font-bold">{TITLES[name]}</h1><div className="w-full max-w-md"><DateRangeFilter value={state.date as string} onChange={v => set({ date: v })} presets={['thisWeek', 'thisMonth', 'lastMonth', 'thisYear']} /></div></div>
      {d && name === 'business' && <>
        <Kpis items={d.kpis as Kpi[]} compare />
        <Card title="Doanh thu thuần theo ngày — kỳ này và kỳ trước"><LineChart {...(d.trend as ChartData)} /></Card>
      </>}
      {d && name === 'products' && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bán chạy nhất"><HBarChart rows={bars(d.top)} /></Card>
        <Card title="Bán chậm nhất (có phát sinh)"><HBarChart rows={bars(d.bottom)} /></Card>
        <Card title="Hàng tồn không bán trong 30 ngày" className="lg:col-span-2">
          <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="p-2">Mã</th><th className="p-2">Tên hàng</th><th className="p-2 text-right">Tồn</th><th className="p-2 text-right">Giá trị (giá bán)</th></tr></thead>
            <tbody>{(d.slowMovers as { code: string; name: string; onHand: number; value: number }[]).map(s => <tr key={s.code} className="border-t border-slate-100"><td className="p-2">{s.code}</td><td className="p-2">{s.name}</td><td className="p-2 text-right">{s.onHand}</td><td className="p-2 text-right tabular-nums">{formatVnd(s.value)}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Phân loại ABC theo doanh thu" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">{(['A', 'B', 'C'] as const).map(cls => { const xs = (d.abc as { cls: string; name: string; net: number }[]).filter(x => x.cls === cls); return <div key={cls} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="font-semibold">Nhóm {cls} · {xs.length} mặt hàng</div><div className="text-slate-500">{formatVnd(xs.reduce((s, x) => s + x.net, 0))}</div><div className="mt-1 line-clamp-3 text-xs text-slate-600">{xs.slice(0, 8).map(x => x.name).join(', ')}</div></div>; })}</div>
        </Card>
      </div>}
      {d && name === 'customers' && <>
        <Kpis items={d.kpis as Kpi[]} compare={false} />
        <div className="grid gap-4 lg:grid-cols-2"><Card title="Khách mua nhiều nhất"><HBarChart rows={bars(d.top)} /></Card><Card title="Doanh thu theo nhóm khách"><HBarChart rows={bars(d.groups)} /></Card></div>
      </>}
      {d && name === 'efficiency' && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Doanh thu theo nhân viên bán"><HBarChart rows={bars(d.staff)} /></Card>
        <Card title="Đơn đặt hàng"><div className="grid grid-cols-2 gap-3 text-sm">{([['Đơn đặt', 'placed'], ['Hoàn thành', 'completed'], ['Đã hủy', 'cancelled'], ['Tỷ lệ chuyển thành hóa đơn', 'conversion']] as const).map(([l, k]) => <div key={k} className="rounded-lg bg-slate-50 p-3"><div className="text-slate-500">{l}</div><div className="text-lg font-semibold">{(d.orders as Record<string, number>)[k]}{k === 'conversion' ? '%' : ''}</div></div>)}</div></Card>
        <Card title="Doanh thu theo giờ trong ngày" className="lg:col-span-2"><BarChart {...(d.hours as ChartData)} /></Card>
      </div>}
    </div>
  );
}
