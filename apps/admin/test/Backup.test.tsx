import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock, downloadMock } = vi.hoisted(() => ({ apiMock: vi.fn(), downloadMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: (...a: unknown[]) => downloadMock(...a), toQueryString: () => '' }));

import { BackupSettings } from '../src/pages/settings/BackupSettings';

beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue({ ok: true }); downloadMock.mockReset(); downloadMock.mockResolvedValue(undefined); });

test('download, restore from a chosen file after confirming, and reset demo only with the typed phrase', async () => {
  renderWithQuery(<BackupSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Tải bản sao lưu' }));
  expect(downloadMock).toHaveBeenCalledWith('/system/backup', undefined, expect.stringMatching(/\.json$/));

  const doc = { app: 'phuongdong-pos', version: 'v1', createdAt: '2026-10-28', tables: {} };
  const file = new File([JSON.stringify(doc)], 'backup.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Chọn file sao lưu'), { target: { files: [file] } });
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Khôi phục' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/system/restore', { body: doc }));

  const reset = screen.getByRole('button', { name: 'Xóa và tạo lại dữ liệu mẫu' });
  expect(reset).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Gõ XOA DU LIEU để xác nhận'), { target: { value: 'XOA DU LIEU' } });
  fireEvent.click(reset);
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/system/reset-demo', { body: { confirm: 'XOA DU LIEU' } }));
});
