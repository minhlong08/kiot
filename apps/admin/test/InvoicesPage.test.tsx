import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), Link: (p: { children: React.ReactNode }) => <a>{p.children}</a> }));

import { InvoicesPage } from '../src/pages/sales/InvoicesPage';

const inv = { id: 5, code: 'HD000005', createdAt: '2026-10-28T03:00:00Z', returnCodes: [], customerCode: 'KH1', customerName: 'Chị Mai', subtotal: 1_000_000, promoDiscount: 0, invoiceDiscount: 50_000, voucherDiscount: 0, total: 950_000, paid: 950_000, debt: 0, status: 'completed', channel: 'store', sellerName: 'TN', isDelivery: false };
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/invoices') return Promise.resolve({ items: [inv], total: 1, totals: { subtotal: 1_000_000, discount: 50_000, total: 950_000, paid: 950_000, debt: 0 } });
    if (path === '/invoices/5') return Promise.resolve({ ...inv, lines: [{ id: 1, productCode: 'NA001', productName: 'Áo vest', unit: 'cái', qty: 1, price: 1_000_000, discount: 0, promoDiscount: 0, amount: 1_000_000, isGift: false }], payments: [{ id: 1, method: 'cash', amount: 950_000, voucherCode: 'TTHD000001', fundName: 'Tiền mặt' }], returns: [], history: [], delivery: null, promotions: [] });
    if (path === '/invoices/5/cancel') return Promise.resolve({ ...inv, status: 'cancelled' });
    return Promise.resolve([]);
  });
});

test('the status filter is sent to the API and totals render', async () => {
  renderWithQuery(<InvoicesPage />);
  expect(await screen.findByText('HD000005')).toBeInTheDocument();
  expect(screen.getByTestId('totals-row')).toHaveTextContent('950,000');
  fireEvent.click(screen.getByLabelText('Đã hủy'));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/invoices' && (c[1]?.query?.status as string[]).includes('cancelled'))).toBe(true));
});

test('cancelling asks for confirmation then calls the API', async () => {
  renderWithQuery(<InvoicesPage />);
  fireEvent.click(await screen.findByText('HD000005'));
  fireEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
  expect(apiMock.mock.calls.some(c => c[0] === '/invoices/5/cancel')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy hóa đơn' }));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/invoices/5/cancel')).toBe(true));
});
