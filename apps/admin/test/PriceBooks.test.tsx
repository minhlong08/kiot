import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true }) }));

import { PriceBooksPage } from '../src/pages/priceBooks/PriceBooksPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/price-books') return Promise.resolve([{ id: 2, name: 'Giá sỉ', isActive: true, branchIds: [], customerGroupIds: [], userIds: [], itemCount: 0, startAt: null, endAt: null, allowOutsideItems: true }]);
    if (path === '/price-books/2/items') return Promise.resolve({ items: [{ productId: 5, code: 'NA001', name: 'Áo vest', basePrice: 1_000_000, cost: 500_000, price: null, prices: { 2: null } }], total: 1 });
    if (path === '/product-groups') return Promise.resolve([]);
    if (path === '/branches') return Promise.resolve({ items: [] });
    return Promise.resolve({ ok: true });
  });
});

test('editing a price in the grid saves it to the book', async () => {
  renderWithQuery(<PriceBooksPage />);

  const cell = await screen.findByLabelText('Giá Giá sỉ NA001');
  fireEvent.change(cell, { target: { value: '900,000' } });
  fireEvent.blur(cell);
  await waitFor(() => {
    const put = apiMock.mock.calls.find(c => c[0] === '/price-books/2/items' && c[1]?.method === 'PUT');
    expect(put?.[1].body).toEqual({ items: [{ productId: 5, price: 900_000 }] });
  });
});
