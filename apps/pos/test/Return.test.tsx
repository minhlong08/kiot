import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), ApiError: class extends Error {} }));

import { ReturnDialog } from '../src/components/ReturnDialog';

apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
  if (path === '/invoices') return Promise.resolve({ items: [{ id: 5, code: 'HD000005', createdAt: '2026-10-28T03:00:00Z', customerName: 'Chị Mai', total: 2_000_000, status: 'completed' }] });
  if (path === '/invoices/5/return-draft') return Promise.resolve({ invoice: { id: 5, code: 'HD000005', customerId: 7, total: 2_000_000 }, lines: [{ invoiceLineId: 11, productId: 1, productCode: 'NA001', productName: 'Áo vest', unit: 'cái', soldQty: 2, qty: 2, price: 1_000_000 }] });
  if (path === '/returns' && init?.body) return Promise.resolve({ id: 1, code: 'TH000001', total: 1_000_000 });
  return Promise.resolve({ items: [] });
});

test('the return quantity is capped at what can still be returned', async () => {
  const onDone = vi.fn();
  render(<ReturnDialog open onClose={() => {}} onDone={onDone} onExchange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('Mã hóa đơn, tên hoặc SĐT khách'), { target: { value: 'HD000005' } });
  fireEvent.click(await screen.findByText('HD000005'));
  const qty = await screen.findByLabelText('Trả NA001');
  fireEvent.change(qty, { target: { value: '5' } });
  expect(qty).toHaveValue('2');
  fireEvent.change(qty, { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Trả hàng' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const post = apiMock.mock.calls.find(c => c[0] === '/returns' && c[1]?.body);
  expect(post![1].body).toMatchObject({ invoiceId: 5, refundMethod: 'cash', lines: [{ invoiceLineId: 11, qty: 1 }] });
});
