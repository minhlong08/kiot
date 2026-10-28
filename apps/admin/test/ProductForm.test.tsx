import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '', ApiError: class extends Error {} }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { ProductForm } from '../src/pages/products/ProductForm';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
    if (path === '/product-groups') return Promise.resolve([{ id: 3, name: 'Thời trang Nam', parentId: null, productCount: 0 }]);
    if (path === '/brands' || path === '/locations') return Promise.resolve([]);
    if (path === '/branches') return Promise.resolve({ items: [{ id: 1, name: 'CN1', code: 'CN01', isActive: true }] });
    if (path === '/settings') return Promise.resolve({ customers: { vndPerPoint: 10000 } });
    if (path === '/products/lookup') return Promise.resolve([{ productId: 11, unitId: null, code: 'CV01', name: 'Cà vạt', unitName: '', conversion: 1, price: 300_000, cost: 100_000, onHand: 4 }]);
    if (path === '/products' && init?.body) return Promise.resolve({ id: 99, code: 'SP000001' });
    return Promise.resolve([]);
  });
});

const noop = () => {};

test('two attributes with two values each produce four variant rows', async () => {
  renderWithQuery(<ProductForm open type="goods" onClose={noop} onSaved={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm thuộc tính' }));
  fireEvent.change(screen.getByLabelText('Tên thuộc tính 1'), { target: { value: 'Màu' } });
  fireEvent.change(screen.getByLabelText('Giá trị thuộc tính 1'), { target: { value: 'Đen, Xám' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm thuộc tính' }));
  fireEvent.change(screen.getByLabelText('Tên thuộc tính 2'), { target: { value: 'Size' } });
  fireEvent.change(screen.getByLabelText('Giá trị thuộc tính 2'), { target: { value: 'M, L' } });
  const table = screen.getByTestId('variants-table');
  expect(within(table).getAllByRole('row')).toHaveLength(5); // header + 4
  expect(within(table).getByText('Xám - L')).toBeInTheDocument();
});

test('saving without a name shows the required error and does not post', async () => {
  renderWithQuery(<ProductForm open type="service" onClose={noop} onSaved={noop} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lưu' }));
  expect(await screen.findByText('Tên hàng là bắt buộc')).toBeInTheDocument();
  expect(apiMock.mock.calls.some(c => c[0] === '/products' && c[1]?.body)).toBe(false);
});

test('a combo posts its components', async () => {
  const onSaved = vi.fn();
  renderWithQuery(<ProductForm open type="combo" onClose={noop} onSaved={onSaved} />);
  fireEvent.change(await screen.findByLabelText('Tên hàng'), { target: { value: 'Set quà tặng' } });
  fireEvent.change(screen.getByLabelText('Nhóm hàng'), { target: { value: '3' } });
  fireEvent.change(screen.getByPlaceholderText('Thêm hàng thành phần'), { target: { value: 'CV01' } });
  fireEvent.click(await screen.findByText('Cà vạt'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const post = apiMock.mock.calls.find(c => c[0] === '/products' && c[1]?.body);
  expect(post![1].body).toMatchObject({ type: 'combo', name: 'Set quà tặng', groupId: 3, comboItems: [{ itemId: 11, qty: 1 }] });
});
