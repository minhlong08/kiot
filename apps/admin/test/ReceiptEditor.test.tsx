import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
const navigate = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { fullName: 'Quản trị viên', branchId: 1 } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate, useParams: () => ({ id: 'new' }) }));

import { ReceiptEditor } from '../src/pages/purchasing/ReceiptEditor';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
    if (path === '/suppliers') return Promise.resolve({ items: [{ id: 4, code: 'NCC000004', name: 'Công ty May Việt', phone: '', debt: 0 }], total: 1 });
    if (path === '/products/lookup') return Promise.resolve([{ productId: 7, unitId: null, code: 'NA001', name: 'Áo vest', unitName: 'cái', conversion: 1, price: 1, cost: 100_000, onHand: 0 }]);
    if (path === '/cash-funds') return Promise.resolve([]);
    if (path === '/purchase-receipts' && init?.body) return Promise.resolve({ id: 1, code: 'PN000001' });
    return Promise.resolve([]);
  });
});

test('totals follow line discount, order discount and other costs; completing posts the payment', async () => {
  renderWithQuery(<ReceiptEditor />);
  fireEvent.change(screen.getByPlaceholderText('Tìm nhà cung cấp'), { target: { value: 'May' } });
  fireEvent.click(await screen.findByText('Công ty May Việt'));
  const picker = screen.getByPlaceholderText('Tìm hàng hóa theo mã hoặc tên (F3)');
  fireEvent.change(picker, { target: { value: 'NA001' } });
  fireEvent.keyDown(picker, { key: 'Enter' });
  const qty = await screen.findByLabelText('Số lượng NA001');
  fireEvent.change(qty, { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Đơn giá NA001'), { target: { value: '100,000' } });
  fireEvent.change(screen.getByLabelText('Giảm giá NA001'), { target: { value: '10,000' } });
  fireEvent.change(screen.getByLabelText('Giảm giá phiếu'), { target: { value: '5,000' } });
  fireEvent.change(screen.getByLabelText('Chi phí nhập khác'), { target: { value: '20,000' } });
  expect(screen.getByTestId('total-due')).toHaveTextContent('205,000');
  expect(screen.getByLabelText('Tiền trả nhà cung cấp')).toHaveValue('205,000');
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
  await waitFor(() => {
    const post = apiMock.mock.calls.find(c => c[0] === '/purchase-receipts' && c[1]?.body);
    expect(post![1].body).toMatchObject({ supplierId: 4, discount: 5_000, otherCosts: 20_000, paid: 205_000, complete: true, lines: [{ productId: 7, qty: 2, unitCost: 100_000, discount: 10_000 }] });
  });
});
