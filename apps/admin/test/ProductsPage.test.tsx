import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } }, branch: { id: 1, name: 'CN1' } }) }));
vi.mock('@tanstack/react-router', () => ({ Link: (p: { children: React.ReactNode }) => <a>{p.children}</a>, useNavigate: () => vi.fn() }));

import { ProductsPage } from '../src/pages/products/ProductsPage';

const product = { id: 7, code: 'NA001', name: 'Áo vest nam xám', type: 'goods', price: 1_599_000, cost: 690_000, onHand: 5, reserved: 1, createdAt: '2026-10-28T00:47:00Z', expectedOutDate: null, imageUrl: null, isActive: true, isDirectSale: true, loyaltyEnabled: false, groupName: 'Thời trang Nam', unit: 'cái' };

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/product-groups') return Promise.resolve([{ id: 3, name: 'Thời trang Nam', parentId: null, productCount: 1 }]);
    if (path === '/brands') return Promise.resolve([]);
    if (path === '/settings') return Promise.resolve({ store: { name: 'Shop' }, customers: { vndPerPoint: 10000 } });
    if (path === '/products') return Promise.resolve({ items: [product], total: 1, totals: { onHand: 900, reserved: 0 } });
    if (path === '/products/7') return Promise.resolve({ ...product, attributes: [], units: [], comboItems: [], variants: [], images: [], warranties: [], stocks: [{ branchId: 1, branchName: 'CN1', onHand: 5, reserved: 1, incoming: 0, cost: 690_000 }], description: '', note: '' });
    if (path === '/products/7/stock-card') return Promise.resolve({ items: [{ id: 1, createdAt: '2026-10-28T01:00:00Z', docType: 'opening', docCode: 'NA001', qtyChange: 5, unitCost: 690_000, balanceAfter: 5, costAfter: 690_000 }], total: 1 });
    return Promise.resolve({ items: [], total: 0 });
  });
});

test('renders rows and the totals row', async () => {
  renderWithQuery(<ProductsPage />);
  expect(await screen.findByText('Áo vest nam xám')).toBeInTheDocument();
  expect(screen.getByTestId('totals-row')).toHaveTextContent('900');
  expect(screen.getByText('1,599,000')).toBeInTheDocument();
});

test('choosing a group filter sends groupIds', async () => {
  renderWithQuery(<ProductsPage />);
  await screen.findByText('Áo vest nam xám');
  fireEvent.click(await screen.findByRole('button', { name: /Thời trang Nam/ }));
  await waitFor(() => expect(apiMock.mock.calls.some(c => c[0] === '/products' && String(c[1]?.query?.groupIds) === '3')).toBe(true));
});

test('expanding a row shows the stock card tab', async () => {
  renderWithQuery(<ProductsPage />);
  fireEvent.click(await screen.findByText('Áo vest nam xám'));
  fireEvent.click(await screen.findByRole('tab', { name: 'Thẻ kho' }));
  expect(await screen.findByText('Tồn kho ban đầu')).toBeInTheDocument();
});
