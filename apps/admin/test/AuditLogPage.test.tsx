import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));

import { AuditLogPage } from '../src/pages/settings/AuditLogPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/audit-logs/entities') return Promise.resolve(['Branch', 'User']);
    return Promise.resolve({
      items: [{ id: 1, createdAt: '2026-10-28T03:00:00Z', userName: 'Quản trị viên', entity: 'Branch', action: 'create', entityCode: 'CN09', summary: 'Tạo chi nhánh Q9', diff: '{}' }],
      total: 1,
    });
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AuditLogPage /></QueryClientProvider>);
}

test('lists audit rows from the api', async () => {
  renderPage();
  expect(await screen.findByText('Tạo chi nhánh Q9')).toBeInTheDocument();
  expect(screen.getByText('28/10/2026 10:00')).toBeInTheDocument();
});

test('filtering by entity passes it to the api', async () => {
  renderPage();
  await screen.findByText('Tạo chi nhánh Q9');
  fireEvent.click(await screen.findByLabelText('Chi nhánh'));
  await waitFor(() => {
    const call = apiMock.mock.calls.find(c => c[0] === '/audit-logs' && c[1]?.query?.entity?.includes('Branch'));
    expect(call).toBeTruthy();
  });
});
