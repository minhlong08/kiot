import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { EInvoicesPage } from '../src/pages/tax/EInvoicesPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/e-invoices') return Promise.resolve({ items: [{ id: 5, invoiceId: 9, invoiceCode: 'HD000009', series: '1C26TPD', number: null, status: 'draft', statusLabel: 'Nháp', buyerName: 'Công ty Hoa Mai', buyerTaxCode: '0101234567', total: 1_190_000, vatAmount: 90_000, totalBeforeVat: 1_100_000, createdAt: '2026-10-28T03:00:00Z', rates: [] }], total: 1, totals: { total: 1_190_000, vatAmount: 90_000, totalBeforeVat: 1_100_000 } });
    return Promise.resolve({ id: 5, status: 'issued', number: '0000001' });
  });
});

test('the issue button issues the draft', async () => {
  renderWithQuery(<EInvoicesPage />);
  fireEvent.click(await screen.findByText('HD000009'));
  fireEvent.click(await screen.findByRole('button', { name: 'Phát hành' }));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/e-invoices/5/issue')).toBe(true));
});
