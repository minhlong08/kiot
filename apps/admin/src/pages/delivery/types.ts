export type DeliveryRow = {
  invoiceId: number; invoiceCode: string; createdAt: string; receiverName: string; receiverPhone: string; address: string; ward: string; province: string;
  partnerId: number | null; partnerName: string; fee: number; cod: number; weight: number; feePayer: 'shop' | 'customer'; note: string; trackingCode: string;
  status: string; statusLabel: string; customerName: string; invoiceTotal: number; reconciledAt: string | null; deliveredAt: string | null;
};
export type DeliveryList = { items: DeliveryRow[]; total: number; totals: { cod: number; fee: number }; statusCounts: Record<string, number> };
export type Partner = { id: number; code: string; name: string; phone: string; email: string; address: string; note: string; feeMode: 'flat' | 'byWeight'; flatFee: number; feePerKg: number; debt: number; isActive: boolean };

export const DELIVERY_STATUSES: { value: string; label: string }[] = [
  { value: 'pending', label: 'Chờ lấy hàng' }, { value: 'picked', label: 'Đã lấy hàng' }, { value: 'delivering', label: 'Đang giao' },
  { value: 'delivered', label: 'Giao thành công' }, { value: 'failed', label: 'Giao thất bại' }, { value: 'returning', label: 'Đang chuyển hoàn' },
  { value: 'returned', label: 'Đã chuyển hoàn' }, { value: 'cancelled', label: 'Đã hủy' },
];
export const STATUS_TONE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700', picked: 'bg-sky-50 text-sky-700', delivering: 'bg-amber-50 text-amber-700', delivered: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-rose-50 text-rose-700', returning: 'bg-orange-50 text-orange-700', returned: 'bg-slate-200 text-slate-600', cancelled: 'bg-slate-100 text-slate-400',
};
