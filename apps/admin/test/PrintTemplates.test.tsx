import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/settings', () => ({ useSettings: () => ({ data: { store: { name: 'Phương Đông', address: '12 Hàng Bạc', phone: '0900' } } }) }));

import { PrintTemplateSettings } from '../src/pages/settings/PrintTemplateSettings';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/print-templates') return Promise.resolve([{ kind: 'invoice', size: '80', body: '<p>{{code}}</p>', isDefault: true }, { kind: 'cashVoucher', size: 'A5', body: '<p>{{title}}</p>', isDefault: true }]);
    return Promise.resolve({});
  });
});

test('inserting a placeholder updates the live preview; saving posts the body', async () => {
  renderWithQuery(<PrintTemplateSettings />);
  const editor = await screen.findByLabelText('Nội dung mẫu in');
  await waitFor(() => expect((screen.getByTitle('Xem trước') as HTMLIFrameElement).srcdoc).toContain('HD000123'));
  fireEvent.change(editor, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
  await waitFor(() => expect((screen.getByTitle('Xem trước') as HTMLIFrameElement).srcdoc).toContain('Nguyễn Thị Mai Anh'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu mẫu' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/print-templates/invoice/80')?.[1]).toEqual({ method: 'PUT', body: { body: '{{customerName}}' } }));
});
