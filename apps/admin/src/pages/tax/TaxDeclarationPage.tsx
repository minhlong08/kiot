import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatVnd } from '@pd/shared';
import { api, download } from '../../lib/api';

type Decl = { year: number; quarter: number; mode: 'household' | 'company'; rows: { rate: number; gross: number; net: number; vat: number }[]; totals: { gross: number; net: number; vat: number }; household: { revenue: number; vat: number; pit: number; total: number; vatRate: number; pitRate: number } };

/** Quarterly revenue by VAT rate (net of returns), with the household flat-tax estimate. */
export function TaxDeclarationPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const d = useQuery({ queryKey: ['tax-declaration', year, quarter], queryFn: () => api<Decl>('/tax/declaration', { query: { year, quarter } }) });
  return (
    <div className="max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Tờ khai thuế</h1>
        <select className="input w-28" aria-label="Năm" value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select className="input w-28" aria-label="Quý" value={quarter} onChange={e => setQuarter(Number(e.target.value))}>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Quý {q}</option>)}</select>
        <button type="button" className="btn" onClick={() => download('/tax/declaration/export', { year, quarter }, `to-khai-thue-Q${quarter}-${year}.xlsx`)}>Xuất file</button>
      </div>
      {d.data && <>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Thuế suất</th><th className="p-3 text-right">Doanh thu (gồm thuế)</th><th className="p-3 text-right">Doanh thu chưa thuế</th><th className="p-3 text-right">Thuế GTGT</th></tr></thead>
            <tbody>
              {d.data.rows.map(r => <tr key={r.rate} className="border-t border-slate-100"><td className="p-3">{r.rate}%</td><td className="p-3 text-right tabular-nums">{formatVnd(r.gross)}</td><td className="p-3 text-right tabular-nums">{formatVnd(r.net)}</td><td className="p-3 text-right tabular-nums">{formatVnd(r.vat)}</td></tr>)}
              {!d.data.rows.length && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Không có doanh thu trong kỳ</td></tr>}
              <tr className="border-t border-slate-200 font-semibold"><td className="p-3">Tổng cộng</td><td className="p-3 text-right tabular-nums">{formatVnd(d.data.totals.gross)}</td><td className="p-3 text-right tabular-nums">{formatVnd(d.data.totals.net)}</td><td className="p-3 text-right tabular-nums">{formatVnd(d.data.totals.vat)}</td></tr>
            </tbody>
          </table>
        </div>
        {d.data.mode === 'household' && (
          <div className="card grid gap-3 p-4 text-sm sm:grid-cols-4">
            <div><div className="text-slate-500">Doanh thu tính thuế</div><div className="text-lg font-semibold tabular-nums">{formatVnd(d.data.household.revenue)}</div></div>
            <div><div className="text-slate-500">GTGT ({d.data.household.vatRate}%)</div><div className="text-lg font-semibold tabular-nums">{formatVnd(d.data.household.vat)}</div></div>
            <div><div className="text-slate-500">TNCN ({d.data.household.pitRate}%)</div><div className="text-lg font-semibold tabular-nums">{formatVnd(d.data.household.pit)}</div></div>
            <div><div className="text-slate-500">Tổng thuế phải nộp</div><div className="text-lg font-semibold tabular-nums text-rose-700">{formatVnd(d.data.household.total)}</div></div>
          </div>
        )}
        <p className="text-sm text-slate-500">Số liệu tham khảo để lập tờ khai: doanh thu bán hàng hoàn thành trong quý trừ hàng bán bị trả lại, thuế GTGT tách ngược từ giá đã gồm thuế.</p>
      </>}
    </div>
  );
}
