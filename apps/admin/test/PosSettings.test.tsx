import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { settingsSchema } from '@pd/shared';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));

import { PosSettings } from '../src/pages/settings/PosSettings';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/settings' && init?.method === 'PUT') return Promise.resolve(settingsSchema.parse({}));
    if (path === '/settings') return Promise.resolve(settingsSchema.parse({}));
    if (path === '/cash-funds') return Promise.resolve([
      { id: 1, type: 'cash', name: 'Tiền mặt' },
      { id: 2, type: 'bank', name: 'Vietcombank', bankName: 'Vietcombank', bankBin: '970436', accountNumber: '0123456789', accountName: 'CUA HANG PHUONG DONG' },
    ]);
    return Promise.resolve([]);
  });
});

test('choosing the VietQR fund saves bankQr from its BIN, number and name', async () => {
  renderWithQuery(<PosSettings />);
  const select = await screen.findByLabelText('Tài khoản VietQR');
  await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
  fireEvent.change(select, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => {
    const put = apiMock.mock.calls.find(c => c[0] === '/settings' && c[1]?.method === 'PUT');
    expect(put![1].body.pos.bankQr).toEqual({ bankBin: '970436', accountNumber: '0123456789', accountName: 'CUA HANG PHUONG DONG' });
  });
});
