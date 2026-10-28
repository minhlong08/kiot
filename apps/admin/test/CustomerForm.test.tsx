import { expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { ApiError, apiMock } = vi.hoisted(() => ({
  ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
  apiMock: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '', ApiError }));

import { CustomerForm } from '../src/pages/customers/CustomerForm';

apiMock.mockImplementation((path: string, init?: { body?: { force?: boolean } }) => {
  if (path === '/customer-groups') return Promise.resolve([]);
  if (path === '/customers' && init?.body) {
    if (!init.body.force) return Promise.reject(new ApiError(409, 'DUPLICATE_PHONE', 'Số điện thoại đã dùng cho khách KH000001 - Lan'));
    return Promise.resolve({ id: 2, code: 'KH000002', name: 'Lan B' });
  }
  return Promise.resolve([]);
});

test('a duplicate phone asks for confirmation and resubmits with force', async () => {
  const onSaved = vi.fn();
  renderWithQuery(<CustomerForm value={{}} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText('Tên khách hàng'), { target: { value: 'Lan B' } });
  fireEvent.change(screen.getByLabelText('Điện thoại'), { target: { value: '0901000001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByText(/Số điện thoại đã dùng cho khách KH000001/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(apiMock.mock.calls.filter(c => c[0] === '/customers' && c[1]?.body).map(c => c[1].body.force)).toEqual([false, true]);
});
