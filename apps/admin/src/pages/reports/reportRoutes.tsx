import type { FC } from 'react';
import { ReportPage, type ReportDef } from './ReportPage';

const R = (title: string, reports: ReportDef[]) => () => <ReportPage title={title} reports={reports} />;

/** Every /reports/* screen is a ReportPage over named API reports. */
export const REPORT_PAGES: Record<string, FC> = {
  '/reports/end-of-day': R('Báo cáo cuối ngày', [{ name: 'end-of-day', label: 'Cuối ngày', params: ['date'] }]),
  '/reports/sales': R('Báo cáo bán hàng', [
    { name: 'sales-by-time', label: 'Thời gian', params: ['range', 'by'] }, { name: 'sales-profit', label: 'Lợi nhuận', params: ['range'] },
    { name: 'sales-discount', label: 'Giảm giá', params: ['range'] }, { name: 'sales-returns', label: 'Trả hàng', params: ['range'] },
    { name: 'sales-by-staff', label: 'Nhân viên', params: ['range', 'role'] }, { name: 'sales-by-branch', label: 'Chi nhánh', params: ['range'] },
  ]),
  '/reports/orders': R('Báo cáo đặt hàng', [{ name: 'orders-by-product', label: 'Hàng hóa', params: ['range'] }, { name: 'orders-by-transaction', label: 'Giao dịch', params: ['range'] }]),
  '/reports/products': R('Báo cáo hàng hóa', [
    { name: 'products-sales', label: 'Bán hàng', params: ['range'] }, { name: 'products-profit', label: 'Lợi nhuận', params: ['range'] },
    { name: 'stock-movement', label: 'Xuất nhập tồn', params: ['range'] }, { name: 'stock-value', label: 'Giá trị kho', params: [] }, { name: 'write-offs', label: 'Xuất hủy', params: ['range'] },
  ]),
  '/reports/customers': R('Báo cáo khách hàng', [{ name: 'customers-sales', label: 'Bán hàng', params: ['range'] }, { name: 'customers-debt', label: 'Công nợ', params: ['range'] }]),
  '/reports/suppliers': R('Báo cáo nhà cung cấp', [{ name: 'suppliers-purchases', label: 'Nhập hàng', params: ['range'] }, { name: 'suppliers-debt', label: 'Công nợ', params: ['range'] }]),
  '/reports/staff': R('Báo cáo nhân viên', [{ name: 'staff-sales', label: 'Bán hàng', params: ['range', 'role'] }, { name: 'staff-payroll', label: 'Lương', params: ['range'] }]),
  '/reports/channels': R('Báo cáo kênh bán hàng', [{ name: 'channels', label: 'Kênh bán', params: ['range'] }]),
  '/reports/finance': R('Báo cáo tài chính', [{ name: 'finance-pnl', label: 'Lãi lỗ', params: ['year'] }]),
};
