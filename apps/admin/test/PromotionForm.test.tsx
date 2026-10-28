import { expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));

import { PromotionForm } from '../src/pages/promotions/PromotionForm';

apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
  if (path === '/promotions' && init?.body) return Promise.resolve({ id: 1, code: 'KM000001' });
  if (path === '/branches') return Promise.resolve({ items: [] });
  return Promise.resolve([]);
});

test('an invoice-discount promotion posts its tiers', async () => {
  const onClose = vi.fn();
  renderWithQuery(<PromotionForm value={{}} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Tên chương trình'), { target: { value: 'Giảm theo hóa đơn' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm mức' }));
  fireEvent.change(screen.getByLabelText('Tổng tiền hàng từ 1'), { target: { value: '2,000,000' } });
  fireEvent.change(screen.getByLabelText('Giảm 1'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => {
    const post = apiMock.mock.calls.find(c => c[0] === '/promotions' && c[1]?.body);
    expect(post![1].body).toMatchObject({ name: 'Giảm theo hóa đơn', type: 'invoiceDiscount', config: { tiers: [{ minTotal: 2_000_000, value: 5, unit: '%' }] } });
  });
});
