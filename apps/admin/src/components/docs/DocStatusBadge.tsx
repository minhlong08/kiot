import clsx from 'clsx';

export const DOC_STATUS: Record<string, { label: string; tone: 'gray' | 'green' | 'blue' | 'red' | 'amber' }> = {
  draft: { label: 'Phiếu tạm', tone: 'gray' },
  completed: { label: 'Hoàn thành', tone: 'green' },
  balanced: { label: 'Đã cân bằng kho', tone: 'green' },
  inTransit: { label: 'Đang chuyển', tone: 'blue' },
  received: { label: 'Đã nhận', tone: 'green' },
  cancelled: { label: 'Đã hủy', tone: 'red' },
  confirmed: { label: 'Đã xác nhận', tone: 'blue' },
  partial: { label: 'Nhập một phần', tone: 'amber' },
};

export function DocStatusBadge({ status }: { status: string }) {
  const s = DOC_STATUS[status] ?? { label: status, tone: 'gray' as const };
  return (
    <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', {
      gray: 'bg-slate-100 text-slate-700', green: 'bg-emerald-50 text-emerald-700', blue: 'bg-sky-50 text-sky-700', red: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700',
    }[s.tone])}>{s.label}</span>
  );
}
