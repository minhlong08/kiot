import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { CashbookPage } from '../src/pages/cashbook/CashbookPage';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
    if (path === '/cash-funds') return Promise.resolve([{ id: 1, type: 'cash', name: 'Tiền mặt', balance: 0 }, { id: 2, type: 'bank', name: 'VCB', balance: 0 }]);
    if (path === '/cash-categories') return Promise.resolve([{ id: 7, kind: 'out', name: 'Chi phí điện nước', isSystem: false, affectsPnl: true }, { id: 8, kind: 'in', name: 'Thu khác', isSystem: true, affectsPnl: true }]);
    if (path === '/cash-vouchers' && !init?.body) return Promise.resolve({ items: [{ id: 1, code: 'TTHD000001', createdAt: '2026-10-28T03:00:00Z', kind: 'in', amount: 350_000, categoryName: 'Thu tiền khách trả', counterpartyName: 'Chị Mai', status: 'completed', sourceType: 'invoice', sourceCode: 'HD000001', fundName: 'Tiền mặt', createdByName: 'QTV', note: '' }], total: 1, summary: { opening: 1_000_000, in: 350_000, out: 0, closing: 1_350_000 } });
    return Promise.resolve({ id: 9, code: 'PC000001' });
  });
});

test('the summary bar shows the period summary', async () => {
  renderWithQuery(<CashbookPage />);
  const bar = await screen.findByTestId('cash-summary');
  await waitFor(() => expect(bar).toHaveTextContent('1,350,000'));
  expect(bar).toHaveTextContent('1,000,000');
});

test('creating a phiếu chi posts kind out with the category and fund', async () => {
  renderWithQuery(<CashbookPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lập phiếu chi' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Loại chi'), { target: { value: '7' } });
  fireEvent.change(within(dialog).getByLabelText('Số tiền'), { target: { value: '500,000' } });
  fireEvent.change(within(dialog).getByLabelText('Tên người nhận'), { target: { value: 'Điện lực' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => {
    const post = apiMock.mock.calls.find(c => c[0] === '/cash-vouchers' && c[1]?.body);
    expect(post![1].body).toMatchObject({ kind: 'out', categoryId: 7, amount: 500_000, fundId: 1, counterpartyType: 'other', counterpartyName: 'Điện lực' });
  });
});
