import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true }) }));

import { SuppliersPage } from '../src/pages/suppliers/SuppliersPage';

const supplier = { id: 4, code: 'NCC000004', name: 'Công ty May Việt', phone: '0281234567', email: '', groupName: '', debt: 3_000_000, totalPurchased: 8_000_000, isActive: true, taxCode: '', address: '', company: '', note: '', groupId: null };

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/supplier-groups') return Promise.resolve([]);
    if (path === '/suppliers') return Promise.resolve({ items: [supplier], total: 1, totals: { debt: 3_000_000, totalPurchased: 8_000_000 } });
    if (path === '/suppliers/4') return Promise.resolve(supplier);
    if (path === '/suppliers/4/ledger') return Promise.resolve({ items: [], total: 0 });
    if (path === '/suppliers/4/history') return Promise.resolve([]);
    if (path === '/cash-funds') return Promise.resolve([{ id: 1, name: 'Tiền mặt', type: 'cash' }, { id: 2, name: 'Vietcombank', type: 'bank' }]);
    return Promise.resolve({ ok: true });
  });
});

test('the payment dialog posts the amount and chosen fund', async () => {
  renderWithQuery(<SuppliersPage />);
  fireEvent.click(await screen.findByText('Công ty May Việt'));
  fireEvent.click(await screen.findByRole('tab', { name: 'Nợ cần trả NCC' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Thanh toán' }));
  const amount = await screen.findByLabelText('Số tiền trả');
  expect(amount).toHaveValue('3,000,000');
  fireEvent.change(amount, { target: { value: '1,000,000' } });
  fireEvent.change(screen.getByLabelText('Quỹ tiền'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tạo phiếu chi' }));
  await waitFor(() => {
    const call = apiMock.mock.calls.find(c => c[0] === '/suppliers/4/payments');
    expect(call?.[1].body).toMatchObject({ amount: 1_000_000, fundId: 2 });
  });
});
