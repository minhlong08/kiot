import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Tabs } from '../../components/Tabs';
import { DocStatusBadge } from '../../components/docs/DocStatusBadge';
import { Pagination } from '../../components/list';

export type SupplierRow = { id: number; code: string; name: string; phone: string; email: string; groupName: string; debt: number; totalPurchased: number; isActive: boolean; taxCode: string; address: string; company: string; note: string; groupId: number | null };

const LEDGER_LABELS: Record<string, string> = {
  receipt: 'Nhập hàng', receiptPayment: 'Thanh toán phiếu nhập', receipt_cancel: 'Hủy nhập hàng', receiptPayment_cancel: 'Hủy thanh toán phiếu nhập',
  purchaseReturn: 'Trả hàng nhập', purchaseReturnRefund: 'NCC hoàn tiền', purchaseReturn_cancel: 'Hủy trả hàng nhập', purchaseReturnRefund_cancel: 'Hủy hoàn tiền',
  supplierPayment: 'Thanh toán', debtAdjust: 'Điều chỉnh công nợ', servicePurchase: 'Mua dịch vụ', servicePurchase_cancel: 'Hủy mua dịch vụ',
};

function Ledger({ id }: { id: number }) {
  const [page, setPage] = useState({ page: 1, pageSize: 15 });
  const q = useQuery({ queryKey: ['supplier-ledger', id, page], queryFn: () => api<{ items: { id: number; createdAt: string; docCode: string; docType: string; amount: number; balanceAfter: number; note: string }[]; total: number }>(`/suppliers/${id}/ledger`, { query: page }) });
  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Mã phiếu</th><th className="px-3 py-2 text-left">Thời gian</th><th className="px-3 py-2 text-left">Loại</th><th className="px-3 py-2 text-right">Giá trị</th><th className="px-3 py-2 text-right">Nợ cần trả NCC</th></tr></thead>
        <tbody>
          {q.data?.items.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-1.5 font-medium text-brand-700">{r.docCode}</td><td className="px-3 py-1.5">{formatDateTime(r.createdAt)}</td>
              <td className="px-3 py-1.5">{LEDGER_LABELS[r.docType] ?? r.docType}{r.note ? ` · ${r.note}` : ''}</td>
              <td className="num px-3 py-1.5">{formatVnd(r.amount)}</td><td className="num px-3 py-1.5">{formatVnd(r.balanceAfter)}</td>
            </tr>
          ))}
          {q.data && !q.data.items.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có giao dịch</td></tr>}
        </tbody>
      </table>
      {(q.data?.total ?? 0) > 15 && <Pagination page={page.page} pageSize={page.pageSize} total={q.data!.total} onChange={(p, s) => setPage({ page: p, pageSize: s })} />}
    </>
  );
}

function History({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['supplier-history', id], queryFn: () => api<{ type: string; id: number; code: string; createdAt: string; total: number; status: string }[]>(`/suppliers/${id}/history`) });
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2 text-left">Mã phiếu</th><th className="px-3 py-2 text-left">Thời gian</th><th className="px-3 py-2 text-left">Loại</th><th className="px-3 py-2 text-right">Tổng cộng</th><th className="px-3 py-2 text-left">Trạng thái</th></tr></thead>
      <tbody>
        {q.data?.map(r => (
          <tr key={`${r.type}-${r.id}`} className="border-t border-slate-100">
            <td className="px-3 py-1.5 font-medium text-brand-700">{r.code}</td><td className="px-3 py-1.5">{formatDateTime(r.createdAt)}</td>
            <td className="px-3 py-1.5">{r.type === 'receipt' ? 'Nhập hàng' : 'Trả hàng nhập'}</td><td className="num px-3 py-1.5">{formatVnd(r.total)}</td>
            <td className="px-3 py-1.5"><DocStatusBadge status={r.status} /></td>
          </tr>
        ))}
        {q.data && !q.data.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có giao dịch</td></tr>}
      </tbody>
    </table>
  );
}

export function SupplierDetail({ s, onEdit, onPay, onAdjust, onToggle, onDelete }: { s: SupplierRow; onEdit: () => void; onPay: () => void; onAdjust: () => void; onToggle: () => void; onDelete: () => void }) {
  const { can } = useAuth();
  const info: [string, string][] = [['Mã nhà cung cấp', s.code], ['Tên', s.name], ['Điện thoại', s.phone], ['Email', s.email], ['Công ty', s.company], ['Mã số thuế', s.taxCode], ['Địa chỉ', s.address], ['Nhóm', s.groupName], ['Ghi chú', s.note]];
  return (
    <Tabs tabs={[
      {
        key: 'info', label: 'Thông tin', content: () => (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-x-6 md:grid-cols-3">
              {info.map(([k, v]) => <div key={k} className="border-b border-slate-100 py-1.5"><div className="text-xs text-slate-500">{k}</div><div className="text-sm">{v || <span className="text-slate-400">Chưa có</span>}</div></div>)}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {can('suppliers.edit') && <button type="button" className="btn-primary" onClick={onEdit}>Cập nhật</button>}
              {can('suppliers.edit') && <button type="button" className="btn" onClick={onToggle}>{s.isActive ? 'Ngừng hoạt động' : 'Cho phép hoạt động'}</button>}
              {can('suppliers.delete') && <button type="button" className="btn text-rose-600" onClick={onDelete}>Xóa</button>}
            </div>
          </div>
        ),
      },
      { key: 'history', label: 'Lịch sử nhập/trả hàng', content: () => <History id={s.id} /> },
      {
        key: 'debt', label: 'Nợ cần trả NCC', content: () => (
          <div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm">Nợ hiện tại: <b className={s.debt < 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatVnd(s.debt)}</b></span>
              <span className="flex gap-2">
                {can('suppliers.edit') && <button type="button" className="btn" onClick={onAdjust}>Điều chỉnh</button>}
                {can('suppliers.edit') && <button type="button" className="btn-primary" onClick={onPay}>Thanh toán</button>}
              </span>
            </div>
            <Ledger id={s.id} />
          </div>
        ),
      },
    ]} />
  );
}
