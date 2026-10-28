import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { WaybillsPage } from '../src/pages/delivery/WaybillsPage';
import { CodReconcileDialog } from '../src/pages/delivery/CodReconcileDialog';

const row = (id: number, o: object = {}) => ({ invoiceId: id, invoiceCode: `HD00000${id}`, createdAt: '2026-10-28T03:00:00Z', receiverName: 'Chị Lan', receiverPhone: '0912', address: 'Hà Nội', province: 'Hà Nội', partnerId: 3, partnerName: 'Giao Nhanh', fee: 20_000, cod: 300_000, feePayer: 'shop', status: 'delivering', statusLabel: 'Đang giao', customerName: 'Khách lẻ', reconciledAt: null, ...o });

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { body?: unknown; query?: Record<string, unknown> }) => {
    if (path === '/deliveries') {
      const items = init?.query?.partnerIds ? [row(1, { status: 'delivered' }), row(2, { status: 'delivered', cod: 150_000, fee: 30_000, feePayer: 'customer' })] : [row(1), row(2)];
      return Promise.resolve({ items, total: items.length, totals: { cod: 0, fee: 0 }, statusCounts: {} });
    }
    if (path === '/delivery-partners') return Promise.resolve({ items: [{ id: 3, name: 'Giao Nhanh', debt: 0 }], total: 1 });
    if (path === '/cash-funds') return Promise.resolve([{ id: 1, type: 'cash', name: 'Tiền mặt' }]);
    if (path === '/deliveries/bulk-status') return Promise.resolve({ results: [{ invoiceId: 1, ok: true }, { invoiceId: 2, ok: true }] });
    return Promise.resolve({ id: 1, code: 'DSCOD000001' });
  });
});

test('bulk status change posts the selected waybills', async () => {
  renderWithQuery(<WaybillsPage />);
  await screen.findByText('HD000001');
  for (const box of screen.getAllByLabelText('Chọn dòng')) fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'Cập nhật trạng thái' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Trạng thái mới'), { target: { value: 'delivered' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/deliveries/bulk-status')?.[1].body).toEqual({ invoiceIds: [1, 2], to: 'delivered' }));
});

test('reconcile dialog totals the selected COD minus shop-paid fees and posts them', async () => {
  renderWithQuery(<CodReconcileDialog open onClose={() => undefined} />);
  await screen.findByRole('option', { name: 'Giao Nhanh' });
  fireEvent.change(screen.getByLabelText('Đối tác'), { target: { value: '3' } });
  const amount = await screen.findByTestId('reconcile-amount');
  await waitFor(() => expect(amount).toHaveTextContent('430,000'));
  fireEvent.click(screen.getAllByLabelText('Chọn vận đơn')[1]);
  await waitFor(() => expect(amount).toHaveTextContent('280,000'));
  fireEvent.click(screen.getByRole('button', { name: 'Đối soát' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/cod-reconciliations')?.[1].body).toMatchObject({ partnerId: 3, invoiceIds: [1], fundId: 1 }));
});
