import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1, isAdmin: true } } }) }));

import { ReportPage } from '../src/pages/reports/ReportPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({
    title: 'Bán hàng theo thời gian', columns: [{ key: 'label', label: 'Thời gian' }, { key: 'net', label: 'Doanh thu thuần', money: true }],
    rows: [{ label: '27/10/2026', net: 1_200_000 }, { label: '28/10/2026', net: 800_000 }], totals: { net: 2_000_000 },
    chart: { type: 'bar', labels: ['27/10', '28/10'], series: [{ name: 'Doanh thu thuần', values: [1_200_000, 800_000] }] },
  });
});

test('renders columns and totals, switches to the chart, and filters change the query', async () => {
  renderWithQuery(<ReportPage title="Báo cáo bán hàng" reports={[{ name: 'sales-by-time', label: 'Thời gian', params: ['range', 'by'] }, { name: 'sales-profit', label: 'Lợi nhuận', params: ['range'] }]} />);
  expect(await screen.findByRole('columnheader', { name: 'Doanh thu thuần' })).toBeInTheDocument();
  expect(screen.getByText('2,000,000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Biểu đồ' }));
  expect(document.querySelectorAll('rect[data-bar]').length).toBe(2);
  fireEvent.change(screen.getByLabelText('Xem theo'), { target: { value: 'hour' } });
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/reports/sales-by-time' && c[1].query.by === 'hour')).toBe(true));
  fireEvent.click(screen.getByRole('tab', { name: 'Lợi nhuận' }));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/reports/sales-profit')).toBe(true));
});
