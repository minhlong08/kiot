import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { fullName: 'QTV', branchId: 1 } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: 'new' }) }));

import { PurchaseReturnEditor } from '../src/pages/purchasing/PurchaseReturnEditor';

beforeEach(() => {
  window.history.replaceState(null, '', '/purchase-returns/new?fromReceipt=9');
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
    if (path === '/purchase-receipts/9/return-draft') return Promise.resolve({ supplierId: 4, receiptId: 9, receiptCode: 'PN000009', lines: [{ productId: 7, unitId: null, productCode: 'NA001', productName: 'Áo vest', unit: 'cái', conversion: 1, qty: 3, price: 100_000 }] });
    if (path === '/suppliers/4') return Promise.resolve({ id: 4, code: 'NCC4', name: 'May Việt' });
    if (path === '/cash-funds') return Promise.resolve([]);
    if (path === '/purchase-returns' && init?.body) return Promise.resolve({ id: 1, code: 'THN000001' });
    return Promise.resolve([]);
  });
});

test('quantity is capped at what is still returnable and the total follows', async () => {
  renderWithQuery(<PurchaseReturnEditor />);
  const qty = await screen.findByLabelText('Số lượng trả NA001');
  fireEvent.change(qty, { target: { value: '5' } });
  expect(qty).toHaveValue('3');
  expect(screen.getByTestId('total-due')).toHaveTextContent('300,000');
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
  await waitFor(() => {
    const post = apiMock.mock.calls.find(c => c[0] === '/purchase-returns' && c[1]?.body);
    expect(post![1].body).toMatchObject({ supplierId: 4, receiptId: 9, complete: true, lines: [{ productId: 7, qty: 3, price: 100_000 }] });
  });
});
