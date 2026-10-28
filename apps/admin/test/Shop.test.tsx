import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));

import { addToCart, cartCount, cartTotal, saveCart, setQty, type Cart } from '../src/pages/shop/cart';
import { ShopCheckout } from '../src/pages/shop/ShopCheckout';

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
  apiMock.mockImplementation((path: string) => {
    if (path === '/shop/info') return Promise.resolve({ name: 'Phương Đông', hotline: '0900', address: '', logoUrl: '', intro: '' });
    if (path === '/shop/orders') return Promise.resolve({ code: 'DH000123', total: 2_500_000 });
    return Promise.resolve({});
  });
});

test('cart merges repeated items, totals lines and drops zero quantities', () => {
  let c: Cart = [];
  c = addToCart(c, { productId: 1, name: 'Áo vest', variant: 'Đen / M', price: 1_200_000, imageUrl: null }, 1);
  c = addToCart(c, { productId: 1, name: 'Áo vest', variant: 'Đen / M', price: 1_200_000, imageUrl: null }, 1);
  c = addToCart(c, { productId: 2, name: 'Cà vạt', variant: '', price: 100_000, imageUrl: null }, 1);
  expect([cartCount(c), cartTotal(c)]).toEqual([3, 2_500_000]);
  c = setQty(c, 2, 0);
  expect(c.map(l => l.productId)).toEqual([1]);
});

test('checkout posts the lines and the customer, then shows the order code', async () => {
  saveCart([{ productId: 1, name: 'Áo vest', variant: 'Đen / M', price: 1_200_000, imageUrl: null, qty: 2 }, { productId: 2, name: 'Cà vạt', variant: '', price: 100_000, imageUrl: null, qty: 1 }]);
  renderWithQuery(<ShopCheckout />);
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('2,500,000');
  fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'Trần Thị Hoa' } });
  fireEvent.change(screen.getByLabelText('Số điện thoại'), { target: { value: '0912345678' } });
  fireEvent.change(screen.getByLabelText('Địa chỉ'), { target: { value: '5 Lý Thường Kiệt' } });
  fireEvent.change(screen.getByLabelText('Tỉnh/Thành phố'), { target: { value: 'TP. Hà Nội' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đặt hàng' }));
  await waitFor(() => {
    const call = apiMock.mock.calls.find(c => c[0] === '/shop/orders');
    expect(call![1].body).toEqual({ customer: { name: 'Trần Thị Hoa', phone: '0912345678', address: '5 Lý Thường Kiệt', province: 'TP. Hà Nội', ward: '', note: '' }, lines: [{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }], website: '' });
  });
  expect(await screen.findByText(/DH000123/)).toBeInTheDocument();
  expect(localStorage.getItem('pd.shop.cart')).toBe('[]');
});
