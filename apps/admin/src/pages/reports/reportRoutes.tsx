import type { FC } from 'react';
import { ReportPage, type ReportDef } from './ReportPage';
import { AnalyticsPage } from './AnalyticsPage';

const R = (title: string, reports: ReportDef[]) => () => <ReportPage title={title} reports={reports} />;

/** Every /reports/* screen is a ReportPage over named API reports. */
export const REPORT_PAGES: Record<string, FC> = {
  '/reports/end-of-day': R('Báo cáo cuối ngày', [{ name: 'end-of-day', label: 'Cuối ngày', params: ['date'] }]),
  '/reports/sales': R('Báo cáo bán hàng', [
    { name: 'sales-by-time', label: 'Thời gian', params: ['range', 'by', 'staff', 'channel', 'group'] }, { name: 'sales-profit', label: 'Lợi nhuận', params: ['range', 'staff', 'channel', 'group'] },
    { name: 'sales-discount', label: 'Giảm giá', params: ['range'] }, { name: 'sales-returns', label: 'Trả hàng', params: ['range'] },
    { name: 'sales-by-staff', label: 'Nhân viên', params: ['range', 'role', 'channel', 'group'] }, { name: 'sales-by-branch', label: 'Chi nhánh', params: ['range', 'staff', 'channel', 'group'] },
  ]),
  '/reports/orders': R('Báo cáo đặt hàng', [{ name: 'orders-by-product', label: 'Hàng hóa', params: ['range'] }, { name: 'orders-by-transaction', label: 'Giao dịch', params: ['range'] }]),
  '/reports/products': R('Báo cáo hàng hóa', [
    { name: 'products-sales', label: 'Bán hàng', params: ['range', 'staff', 'channel', 'group'] }, { name: 'products-profit', label: 'Lợi nhuận', params: ['range', 'staff', 'channel', 'group'] },
    { name: 'stock-movement', label: 'Xuất nhập tồn', params: ['range'] }, { name: 'stock-value', label: 'Giá trị kho', params: [] }, { name: 'write-offs', label: 'Xuất hủy', params: ['range'] },
  ]),
  '/reports/customers': R('Báo cáo khách hàng', [{ name: 'customers-sales', label: 'Bán hàng', params: ['range', 'staff', 'channel', 'group'] }, { name: 'customers-debt', label: 'Công nợ', params: ['range'] }]),
  '/reports/suppliers': R('Báo cáo nhà cung cấp', [{ name: 'suppliers-purchases', label: 'Nhập hàng', params: ['range'] }, { name: 'suppliers-debt', label: 'Công nợ', params: ['range'] }]),
  '/reports/staff': R('Báo cáo nhân viên', [{ name: 'staff-sales', label: 'Bán hàng', params: ['range', 'role'] }, { name: 'staff-payroll', label: 'Lương', params: ['range'] }]),
  '/reports/channels': R('Báo cáo kênh bán hàng', [{ name: 'channels', label: 'Kênh bán', params: ['range', 'staff', 'group'] }]),
  '/analytics/business': () => <AnalyticsPage name="business" />,
  '/analytics/products': () => <AnalyticsPage name="products" />,
  '/analytics/customers': () => <AnalyticsPage name="customers" />,
  '/analytics/efficiency': () => <AnalyticsPage name="efficiency" />,
  '/reports/finance': R('Báo cáo tài chính', [{ name: 'finance-pnl', label: 'Lãi lỗ', params: ['year'] }]),
};
