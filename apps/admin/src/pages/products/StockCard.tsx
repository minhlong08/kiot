import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { DOC_TYPE_LABELS } from '../../lib/labels';
import { Pagination } from '../../components/list';

type Row = { id: number; createdAt: string; docType: string; docCode: string; qtyChange: number; unitCost?: number; balanceAfter: number; costAfter?: number; note: string };

export function StockCard({ productId }: { productId: number }) {
  const [page, setPage] = useState({ page: 1, pageSize: 15 });
  const q = useQuery({ queryKey: ['stock-card', productId, page], queryFn: () => api<{ items: Row[]; total: number }>(`/products/${productId}/stock-card`, { query: page }) });
  const showCost = q.data?.items.some(r => r.unitCost !== undefined);
  return (
    <div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Chứng từ</th><th className="px-3 py-2 text-left">Thời gian</th><th className="px-3 py-2 text-left">Loại giao dịch</th>
            {showCost && <th className="px-3 py-2 text-right">Giá vốn</th>}
            <th className="px-3 py-2 text-right">Số lượng</th><th className="px-3 py-2 text-right">Tồn cuối</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.items.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5 font-medium text-brand-700">{r.docCode}</td>
              <td className="px-3 py-1.5">{formatDateTime(r.createdAt)}</td>
              <td className="px-3 py-1.5">{DOC_TYPE_LABELS[r.docType] ?? r.docType}</td>
              {showCost && <td className="num px-3 py-1.5">{formatVnd(r.unitCost ?? 0)}</td>}
              <td className={`num px-3 py-1.5 ${r.qtyChange < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.qtyChange > 0 ? '+' : ''}{formatVnd(r.qtyChange)}</td>
              <td className="num px-3 py-1.5">{formatVnd(r.balanceAfter)}</td>
            </tr>
          ))}
          {q.data && !q.data.items.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Chưa có giao dịch</td></tr>}
        </tbody>
      </table>
      {(q.data?.total ?? 0) > 15 && <Pagination page={page.page} pageSize={page.pageSize} total={q.data?.total ?? 0} onChange={(p, s) => setPage({ page: p, pageSize: s })} />}
    </div>
  );
}
