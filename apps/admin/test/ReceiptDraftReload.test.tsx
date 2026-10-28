import { expect, test, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from './utils';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { fullName: 'QTV', branchId: 1 } } }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: '5' }) }));

import { ReceiptEditor } from '../src/pages/purchasing/ReceiptEditor';

apiMock.mockImplementation((path: string) => {
  if (path === '/purchase-receipts/5') return Promise.resolve({
    id: 5, code: 'PN000005', status: 'draft', supplierId: 4, supplierCode: 'NCC4', supplierName: 'May Việt', createdAt: '2026-10-28T01:00:00Z', note: '',
    discount: 0, otherCosts: 0, paid: 200_000, total: 200_000, invoiceNo: '', fundId: null,
    lines: [{ productId: 7, unitId: null, productCode: 'NA001', productName: 'Áo', unit: 'cái', conversion: 1, qty: 2, unitCost: 100_000, discount: 0 }],
  });
  return Promise.resolve([]);
});

test('a reopened draft whose payment equalled the total keeps following the total', async () => {
  renderWithQuery(<ReceiptEditor />);
  fireEvent.change(await screen.findByLabelText('Số lượng NA001'), { target: { value: '3' } });
  expect(screen.getByLabelText('Tiền trả nhà cung cấp')).toHaveValue('300,000');
  expect(screen.getByLabelText('Quỹ tiền')).not.toBeDisabled();
});
