import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1, fullName: 'Quản trị viên' } } }) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a> }));

import { BarChart, HBarChart } from '../src/components/charts';
import { DashboardPage } from '../src/pages/DashboardPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { query?: Record<string, string> }) => {
    if (path === '/dashboard/today') return Promise.resolve({ revenue: 2_000_000, returns: 0, net: 2_000_000, invoiceCount: 3, cost: 0, profit: 0, previous: { net: 1_000_000 }, change: { revenue: 100, returns: null, net: 100 } });
    if (path === '/dashboard/chart') return Promise.resolve({ labels: init?.query?.by === 'hour' ? ['08h', '09h'] : ['26/10', '27/10', '28/10'], series: [{ name: 'Doanh thu thuần', values: [1, 2, 3] }] });
    return Promise.resolve([]);
  });
});

test('BarChart draws one bar per value; HBarChart labels each row', () => {
  const { container } = render(<BarChart labels={['a', 'b', 'c']} series={[{ name: 'x', values: [1, 0, 3] }]} />);
  expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(3);
  render(<HBarChart rows={[{ label: 'Áo vest', value: 5 }, { label: 'Cà vạt', value: 2 }]} />);
  expect(screen.getByText('Áo vest')).toBeInTheDocument();
});

test('dashboard KPI shows % change; chart tabs switch the grouping', async () => {
  renderWithQuery(<DashboardPage />);
  expect((await screen.findAllByText('2,000,000')).length).toBe(2);
  expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: 'Theo giờ' }));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/dashboard/chart' && c[1]?.query?.by === 'hour')).toBe(true));
});
