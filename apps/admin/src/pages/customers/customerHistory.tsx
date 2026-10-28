import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';

function History({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['customer-history', id], queryFn: () => api<{ type: string; id: number; code: string; createdAt: string; total: number; status: string; sellerName: string }[]>(`/customers/${id}/history`) });
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Mã</th><th className="px-3 py-2 text-left">Thời gian</th><th className="px-3 py-2 text-left">Người bán</th><th className="px-3 py-2 text-right">Tổng cộng</th><th className="px-3 py-2 text-left">Trạng thái</th></tr></thead>
      <tbody>
        {q.data?.map(r => (
          <tr key={`${r.type}-${r.id}`} className="border-t border-slate-100">
            <td className="px-3 py-1.5 font-medium text-brand-700">{r.code}</td><td className="px-3 py-1.5">{formatDateTime(r.createdAt)}</td><td className="px-3 py-1.5">{r.sellerName}</td>
            <td className="num px-3 py-1.5">{formatVnd(r.total)}</td><td className="px-3 py-1.5">{r.status === 'cancelled' ? 'Đã hủy' : r.type === 'return' ? 'Trả hàng' : 'Hoàn thành'}</td>
          </tr>
        ))}
        {q.data && !q.data.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có giao dịch</td></tr>}
      </tbody>
    </table>
  );
}

/** Purchase history tab of the customer detail. */
export function customerHistoryTab(customerId: number): (() => ReactNode) | undefined {
  return () => <History id={customerId} />;
}
