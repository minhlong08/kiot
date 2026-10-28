import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Tabs } from '../../components/Tabs';
import { Pagination } from '../../components/list';

export type CustomerRow = {
  id: number; code: string; name: string; phone: string; phone2: string; email: string; birthday: string | null; gender: 'male' | 'female' | ''; type: 'person' | 'company'; company: string; taxCode: string;
  address: string; ward: string; province: string; groupId: number | null; groupName: string; note: string; isActive: boolean; debt: number; points: number; totalSpent: number; createdAt: string; lastPurchaseAt: string | null;
};

const DOC_LABELS: Record<string, string> = {
  invoice: 'Bán hàng', invoice_cancel: 'Hủy hóa đơn', return: 'Trả hàng', customerPayment: 'Thu tiền', debtAdjust: 'Điều chỉnh', pointsAdjust: 'Điều chỉnh điểm',
  invoiceRedeem: 'Dùng điểm', invoicePayment: 'Thanh toán hóa đơn',
};

function Rows({ path, value }: { path: string; value: 'amount' | 'points' }) {
  const [page, setPage] = useState({ page: 1, pageSize: 15 });
  const q = useQuery({ queryKey: [path, page], queryFn: () => api<{ items: { id: number; createdAt: string; docCode: string; docType: string; amount?: number; points?: number; balanceAfter: number; note: string }[]; total: number }>(path, { query: page }) });
  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Mã phiếu</th><th className="px-3 py-2 text-left">Thời gian</th><th className="px-3 py-2 text-left">Loại</th><th className="px-3 py-2 text-right">{value === 'amount' ? 'Giá trị' : 'Điểm'}</th><th className="px-3 py-2 text-right">{value === 'amount' ? 'Dư nợ' : 'Điểm sau GD'}</th></tr></thead>
        <tbody>
          {q.data?.items.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5 font-medium text-brand-700">{r.docCode}</td><td className="px-3 py-1.5">{formatDateTime(r.createdAt)}</td>
              <td className="px-3 py-1.5">{DOC_LABELS[r.docType] ?? r.docType}{r.note ? ` · ${r.note}` : ''}</td>
              <td className="num px-3 py-1.5">{formatVnd((value === 'amount' ? r.amount : r.points) ?? 0)}</td><td className="num px-3 py-1.5">{formatVnd(r.balanceAfter)}</td>
            </tr>
          ))}
          {q.data && !q.data.items.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có giao dịch</td></tr>}
        </tbody>
      </table>
      {(q.data?.total ?? 0) > 15 && <Pagination page={page.page} pageSize={page.pageSize} total={q.data!.total} onChange={(p, s) => setPage({ page: p, pageSize: s })} />}
    </>
  );
}

type Actions = { onEdit: () => void; onPay: () => void; onAdjustDebt: () => void; onAdjustPoints: () => void; onToggle: () => void; onDelete: () => void };

export function CustomerDetail({ c, actions, historyTab }: { c: CustomerRow; actions: Actions; historyTab?: () => React.ReactNode }) {
  const { can } = useAuth();
  const info: [string, string][] = [
    ['Mã khách hàng', c.code], ['Tên', c.name], ['Điện thoại', [c.phone, c.phone2].filter(Boolean).join(' / ')], ['Email', c.email],
    ['Ngày sinh', c.birthday ? formatDate(c.birthday) : ''], ['Giới tính', c.gender === 'male' ? 'Nam' : c.gender === 'female' ? 'Nữ' : ''],
    ['Địa chỉ', [c.address, c.ward, c.province].filter(Boolean).join(', ')], ['Nhóm', c.groupName], ['Công ty / MST', [c.company, c.taxCode].filter(Boolean).join(' / ')],
    ['Ngày tạo', formatDate(c.createdAt)], ['Mua gần nhất', c.lastPurchaseAt ? formatDateTime(c.lastPurchaseAt) : ''], ['Ghi chú', c.note],
  ];
  return (
    <Tabs tabs={[
      {
        key: 'info', label: 'Thông tin', content: () => (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-x-6 md:grid-cols-4">
              {info.map(([k, v]) => <div key={k} className="border-b border-slate-100 py-1.5"><div className="text-xs text-slate-500">{k}</div><div className="text-sm">{v || <span className="text-slate-400">Chưa có</span>}</div></div>)}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {can('customers.edit') && <button type="button" className="btn-primary" onClick={actions.onEdit}>Cập nhật</button>}
              {can('customers.edit') && <button type="button" className="btn" onClick={actions.onToggle}>{c.isActive ? 'Ngừng hoạt động' : 'Cho phép hoạt động'}</button>}
              {can('customers.delete') && <button type="button" className="btn text-rose-600" onClick={actions.onDelete}>Xóa</button>}
            </div>
          </div>
        ),
      },
      ...(historyTab ? [{ key: 'history', label: 'Lịch sử bán/trả hàng', content: historyTab }] : []),
      {
        key: 'debt', label: 'Nợ cần thu từ khách', content: () => (
          <div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">Nợ hiện tại: <b className={c.debt > 0 ? 'text-rose-700' : ''}>{formatVnd(c.debt)}</b></span>
              <span className="flex gap-2">
                {can('customers.adjust') && <button type="button" className="btn" onClick={actions.onAdjustDebt}>Điều chỉnh</button>}
                {can('customers.edit') && <button type="button" className="btn-primary" onClick={actions.onPay}>Thu tiền</button>}
              </span>
            </div>
            <Rows path={`/customers/${c.id}/ledger`} value="amount" />
          </div>
        ),
      },
      {
        key: 'points', label: 'Lịch sử tích điểm', content: () => (
          <div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">Điểm hiện tại: <b>{formatVnd(c.points)}</b></span>
              {can('customers.adjust') && <button type="button" className="btn" onClick={actions.onAdjustPoints}>Điều chỉnh điểm</button>}
            </div>
            <Rows path={`/customers/${c.id}/points`} value="points" />
          </div>
        ),
      },
    ]} />
  );
}
