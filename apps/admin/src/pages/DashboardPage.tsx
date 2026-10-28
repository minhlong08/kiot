import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, ShoppingCart, Users, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { PERIOD_LABELS, formatVnd, type PeriodName } from '@pd/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BarChart, HBarChart } from '../components/charts';

type Today = { revenue: number; returns: number; net: number; invoiceCount: number; change: { revenue: number | null; returns: number | null; net: number | null } };
type Ranked = { name: string; value: number };
const CHART_PERIODS: PeriodName[] = ['today', 'yesterday', 'thisWeek', 'last7days', 'thisMonth', 'lastMonth'];

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-xs text-slate-400">—</span>;
  const up = v >= 0;
  return <span className={clsx('inline-flex items-center text-xs font-medium', up ? 'text-emerald-700' : 'text-rose-700')}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(v)}%</span>;
}
const PeriodSelect = ({ value, onChange, label }: { value: PeriodName; onChange: (p: PeriodName) => void; label: string }) => (
  <select className="input w-36 py-1 text-sm" aria-label={label} value={value} onChange={e => onChange(e.target.value as PeriodName)}>{CHART_PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</select>
);

export function DashboardPage() {
  const { me, can } = useAuth();
  const [by, setBy] = useState<'day' | 'hour' | 'weekday'>('day');
  const [chartPeriod, setChartPeriod] = useState<PeriodName>('thisMonth');
  const [topPeriod, setTopPeriod] = useState<PeriodName>('thisMonth');
  const [metric, setMetric] = useState<'revenue' | 'qty'>('revenue');
  const today = useQuery({ queryKey: ['dashboard', 'today'], queryFn: () => api<Today>('/dashboard/today'), refetchInterval: 60_000 });
  const chart = useQuery({ queryKey: ['dashboard', 'chart', by, chartPeriod], queryFn: () => api<{ labels: string[]; series: { name: string; values: number[] }[] }>('/dashboard/chart', { query: { by, period: chartPeriod } }) });
  const top = useQuery({ queryKey: ['dashboard', 'top', topPeriod, metric], queryFn: () => api<Ranked[]>('/dashboard/top-products', { query: { period: topPeriod, metric } }) });
  const customers = useQuery({ queryKey: ['dashboard', 'customers', topPeriod], queryFn: () => api<Ranked[]>('/dashboard/top-customers', { query: { period: topPeriod } }) });
  const staff = useQuery({ queryKey: ['dashboard', 'staff', topPeriod], queryFn: () => api<{ name: string; net: number }[]>('/dashboard/staff', { query: { period: topPeriod } }) });
  const activity = useQuery({ queryKey: ['dashboard', 'activity'], queryFn: () => api<{ code: string; text: string; ago: string }[]>('/dashboard/activity'), refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ['dashboard', 'alerts'], queryFn: () => api<{ kind: string; username: string; count?: number; ip?: string }[]>('/dashboard/alerts') });
  const t = today.data;
  return (
    <div className="flex flex-col gap-4 p-4 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Kết quả bán hàng hôm nay</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([['Doanh thu', t?.revenue, t?.change.revenue, `${t?.invoiceCount ?? 0} hóa đơn`], ['Trả hàng', t?.returns, t?.change.returns, ''], ['Doanh thu thuần', t?.net, t?.change.net, 'so với cùng kỳ tháng trước']] as const).map(([label, v, ch, sub]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-semibold tabular-nums">{formatVnd(v ?? 0)}</div><div className="flex items-center gap-2"><Change v={ch ?? null} /><span className="text-xs text-slate-400">{sub}</span></div></div>
            ))}
          </div>
        </section>
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">Doanh thu thuần</h2>
            <div role="tablist" className="flex rounded-lg bg-slate-100 p-0.5 text-sm">
              {([['day', 'Theo ngày'], ['hour', 'Theo giờ'], ['weekday', 'Theo thứ']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={by === k} type="button" onClick={() => setBy(k)} className={clsx('rounded-md px-3 py-1', by === k && 'bg-white shadow-sm')}>{l}</button>)}
            </div>
            <PeriodSelect label="Kỳ biểu đồ" value={chartPeriod} onChange={setChartPeriod} />
          </div>
          {chart.data && <BarChart labels={chart.data.labels} series={chart.data.series} />}
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Top 10 hàng hóa bán chạy</h2>
              <select className="input w-32 py-1 text-sm" aria-label="Tiêu chí" value={metric} onChange={e => setMetric(e.target.value as 'revenue' | 'qty')}><option value="revenue">Theo doanh thu</option><option value="qty">Theo số lượng</option></select>
              <PeriodSelect label="Kỳ xếp hạng" value={topPeriod} onChange={setTopPeriod} /></div>
            <HBarChart rows={(top.data ?? []).map(r => ({ label: r.name, value: r.value }))} format={metric === 'qty' ? n => `${n}` : formatVnd} />
          </section>
          <section className="card p-4"><h2 className="mb-3 font-semibold">Top 10 khách mua nhiều nhất</h2><HBarChart rows={(customers.data ?? []).map(r => ({ label: r.name, value: r.value }))} /></section>
        </div>
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Hiệu quả nhân viên</h2>
          {staff.data?.length ? <HBarChart rows={staff.data.map(s => ({ label: s.name, value: s.net }))} /> : (
            <div className="py-6 text-center text-sm text-slate-500">Chưa có số liệu bán hàng theo nhân viên.{can('employees.create') && <Link to="/employees" className="btn ml-2">Thêm nhân viên</Link>}</div>
          )}
        </section>
      </div>
      <aside className="w-full space-y-4 xl:w-80">
        {!!alerts.data?.length && (
          <section className="card border-amber-300 bg-amber-50 p-4 text-sm">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle size={16} />Đăng nhập bất thường</h2>
            <ul className="space-y-1 text-amber-900">{alerts.data.map((a, i) => <li key={i}>{a.kind === 'failedLogins' ? `${a.username}: ${a.count} lần nhập sai mật khẩu trong 24 giờ` : `${a.username} đăng nhập từ địa chỉ mới ${a.ip}`}</li>)}</ul>
            <Link to="/settings/audit-log" className="mt-2 inline-block text-amber-900 underline">Xem lịch sử thao tác</Link>
          </section>
        )}
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Xin chào, {me?.user.fullName}</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[{ to: '/sale/', label: 'Bán hàng', icon: ShoppingCart, ext: true }, { to: '/products', label: 'Hàng hóa', icon: Boxes }, { to: '/customers', label: 'Khách hàng', icon: Users }, { to: '/cashbook', label: 'Sổ quỹ', icon: Wallet }].map(q => q.ext
              ? <a key={q.to} href={q.to} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 hover:bg-slate-100"><q.icon size={16} />{q.label}</a>
              : <Link key={q.to} to={q.to} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 hover:bg-slate-100"><q.icon size={16} />{q.label}</Link>)}
          </div>
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Hoạt động gần đây</h2>
          <ul className="space-y-3 text-sm">{activity.data?.map((a, i) => <li key={i} className="border-l-2 border-brand-200 pl-3"><div>{a.text}</div><div className="text-xs text-slate-400">{a.code} · {a.ago}</div></li>)}</ul>
          {activity.data && !activity.data.length && <p className="text-sm text-slate-400">Chưa có hoạt động</p>}
        </section>
      </aside>
    </div>
  );
}
