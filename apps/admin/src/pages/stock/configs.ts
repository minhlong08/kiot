import type { LineColumn } from '../../components/docs/DocumentLinesEditor';

export type StockDocKind = 'stockTake' | 'writeOff' | 'internalUse' | 'transfer';

export type StockDocConfig = {
  kind: StockDocKind;
  title: string;
  newTitle: string;
  route: string;
  api: string;
  /** Extra query/body field for issues. */
  issueKind?: 'writeOff' | 'internalUse';
  perm: string;
  qtyKey: string;
  statuses: { value: string; label: string }[];
  listColumns: { key: string; header: string; money?: boolean; total?: boolean }[];
  lineColumns: (mode: 'edit' | 'view' | 'receive') => LineColumn[];
  /** Payload field names. */
  completeFlag: string;
  completeLabel: string;
  completePath: string;
  exportName: string;
};

const num = (v: unknown) => Number(v ?? 0);

export const STOCK_DOCS: Record<StockDocKind, StockDocConfig> = {
  stockTake: {
    kind: 'stockTake', title: 'Kiểm kho', newTitle: 'Kiểm kho', route: '/stock-takes', api: '/stock-takes', perm: 'stockTakes', qtyKey: 'actualQty',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'balanced', label: 'Đã cân bằng kho' }, { value: 'cancelled', label: 'Đã hủy' }],
    listColumns: [
      { key: 'balancedAt', header: 'Ngày cân bằng' }, { key: 'totalActualQty', header: 'SL thực tế', money: true, total: true },
      { key: 'totalDiffQty', header: 'Tổng chênh lệch', money: true, total: true }, { key: 'totalDiffValue', header: 'Giá trị lệch', money: true, total: true },
    ],
    lineColumns: mode => [
      { key: 'systemQty', header: 'Tồn kho', kind: 'readonly', value: l => num(l.systemQty ?? l.onHand) },
      { key: 'actualQty', header: 'Thực tế', kind: mode === 'edit' ? 'qty' : 'readonly' },
      { key: 'diffQty', header: 'SL lệch', kind: 'readonly', value: l => num(l.actualQty) - num(l.systemQty ?? l.onHand) },
      ...(mode === 'view' ? [{ key: 'diffValue', header: 'Giá trị lệch', kind: 'readonlyMoney' as const }] : []),
    ],
    completeFlag: 'balance', completeLabel: 'Hoàn thành', completePath: 'balance', exportName: 'kiem-kho.xlsx',
  },
  writeOff: {
    kind: 'writeOff', title: 'Xuất hủy', newTitle: 'Xuất hủy', route: '/write-offs', api: '/stock-issues', issueKind: 'writeOff', perm: 'writeOffs', qtyKey: 'qty',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'completed', label: 'Hoàn thành' }, { value: 'cancelled', label: 'Đã hủy' }],
    listColumns: [{ key: 'reason', header: 'Lý do' }, { key: 'totalQty', header: 'Tổng SL', money: true, total: true }, { key: 'totalValue', header: 'Tổng giá trị hủy', money: true, total: true }],
    lineColumns: mode => [
      { key: 'onHand', header: 'Tồn kho', kind: 'readonly', value: l => num(l.onHand) },
      { key: 'qty', header: 'SL hủy', kind: mode === 'edit' ? 'qty' : 'readonly' },
      ...(mode === 'view' ? [{ key: 'value', header: 'Giá trị hủy', kind: 'readonlyMoney' as const }] : []),
    ],
    completeFlag: 'complete', completeLabel: 'Hoàn thành', completePath: 'complete', exportName: 'xuat-huy.xlsx',
  },
  internalUse: {
    kind: 'internalUse', title: 'Xuất dùng nội bộ', newTitle: 'Xuất dùng nội bộ', route: '/internal-uses', api: '/stock-issues', issueKind: 'internalUse', perm: 'internalUse', qtyKey: 'qty',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'completed', label: 'Hoàn thành' }, { value: 'cancelled', label: 'Đã hủy' }],
    listColumns: [{ key: 'reason', header: 'Mục đích' }, { key: 'totalQty', header: 'Tổng SL', money: true, total: true }, { key: 'totalValue', header: 'Tổng giá trị', money: true, total: true }],
    lineColumns: mode => [
      { key: 'onHand', header: 'Tồn kho', kind: 'readonly', value: l => num(l.onHand) },
      { key: 'qty', header: 'Số lượng', kind: mode === 'edit' ? 'qty' : 'readonly' },
      ...(mode === 'view' ? [{ key: 'value', header: 'Giá trị', kind: 'readonlyMoney' as const }] : []),
    ],
    completeFlag: 'complete', completeLabel: 'Hoàn thành', completePath: 'complete', exportName: 'xuat-dung-noi-bo.xlsx',
  },
  transfer: {
    kind: 'transfer', title: 'Chuyển hàng', newTitle: 'Chuyển hàng', route: '/transfers', api: '/transfers', perm: 'transfers', qtyKey: 'qtySent',
    statuses: [{ value: 'draft', label: 'Phiếu tạm' }, { value: 'inTransit', label: 'Đang chuyển' }, { value: 'received', label: 'Đã nhận' }, { value: 'cancelled', label: 'Đã hủy' }],
    listColumns: [
      { key: 'fromBranchName', header: 'Từ chi nhánh' }, { key: 'toBranchName', header: 'Tới chi nhánh' },
      { key: 'totalSentQty', header: 'SL chuyển', money: true, total: true }, { key: 'totalReceivedQty', header: 'SL nhận', money: true, total: true }, { key: 'totalValue', header: 'Giá trị chuyển', money: true, total: true },
    ],
    lineColumns: mode => [
      ...(mode === 'edit' ? [{ key: 'onHand', header: 'Tồn kho', kind: 'readonly' as const, value: (l: Record<string, unknown>) => num(l.onHand) }] : []),
      { key: 'qtySent', header: 'SL chuyển', kind: mode === 'edit' ? 'qty' : 'readonly' },
      ...(mode !== 'edit' ? [{ key: 'qtyReceived', header: 'SL nhận', kind: mode === 'receive' ? ('qty' as const) : ('readonly' as const) }] : []),
    ],
    completeFlag: 'send', completeLabel: 'Chuyển hàng', completePath: 'send', exportName: 'chuyen-hang.xlsx',
  },
};
