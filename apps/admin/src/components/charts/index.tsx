import { formatVnd } from '@pd/shared';

export type Series = { name: string; values: number[] };
const COLORS = ['#0f766e', '#d97706', '#6366f1', '#e11d48'];

/** 1,250,000 → "1,25tr"; 350,000 → "350k". */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.', ',')} tỷ`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}tr`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
function ticks(max: number) {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / 4 || 1));
  const nice = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => max / s <= 5) ?? step * 10;
  return Array.from({ length: Math.ceil(max / nice) + 1 }, (_, i) => i * nice);
}

/** Vertical bars (grouped when several series); a <title> on each bar is the tooltip. */
export function BarChart({ labels, series, height = 260, kind = 'bar' }: { labels: string[]; series: Series[]; height?: number; kind?: 'bar' | 'line' }) {
  const W = Math.max(320, labels.length * 36), H = height, L = 52, B = 28, T = 10;
  const all = series.flatMap(s => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const ys = ticks(max);
  const top = ys[ys.length - 1] || 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (top - min || 1));
  const band = (W - L) / Math.max(1, labels.length);
  const barW = Math.max(3, Math.min(28, (band * 0.7) / series.length));
  const every = Math.ceil(labels.length / 16);
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[320px]" role="img" aria-label={series.map(s => s.name).join(', ')}>
        {ys.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#e2e8f0" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">{compact(v)}</text></g>)}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={L + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{l}</text>)}
        {kind === 'bar' && series.map((s, k) => s.values.map((v, i) => (
          <rect key={`${k}-${i}`} data-bar x={L + band * i + (band - barW * series.length) / 2 + k * barW} y={Math.min(y(v), y(0))} width={barW} height={Math.abs(y(0) - y(v))} rx={2} fill={COLORS[k % COLORS.length]}>
            <title>{`${labels[i]} · ${s.name}: ${formatVnd(v)}`}</title>
          </rect>
        )))}
        {kind === 'line' && series.map((s, k) => (
          <g key={k}>
            <polyline fill="none" stroke={COLORS[k % COLORS.length]} strokeWidth={2} points={s.values.map((v, i) => `${L + band * i + band / 2},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => <circle key={i} cx={L + band * i + band / 2} cy={y(v)} r={3} fill={COLORS[k % COLORS.length]}><title>{`${labels[i]} · ${s.name}: ${formatVnd(v)}`}</title></circle>)}
          </g>
        ))}
      </svg>
      {series.length > 1 && <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">{series.map((s, k) => <span key={s.name} className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: COLORS[k % COLORS.length] }} />{s.name}</span>)}</div>}
    </div>
  );
}

export const LineChart = (p: { labels: string[]; series: Series[]; height?: number }) => <BarChart {...p} kind="line" />;

/** Horizontal bars for rankings (top products/customers). */
export function HBarChart({ rows, format = formatVnd }: { rows: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-2">
      {rows.map(r => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="shrink-0 tabular-nums text-slate-600">{format(r.value)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
      {!rows.length && <li className="py-6 text-center text-sm text-slate-400">Chưa có dữ liệu</li>}
    </ul>
  );
}
