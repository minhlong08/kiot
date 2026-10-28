import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { PayrollPeriodView } from '../src/pages/staff/PayrollPeriodView';
import { CommissionTableForm } from '../src/pages/staff/CommissionTableForm';

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/payroll-periods/4') return Promise.resolve({ id: 4, code: 'BL000004', name: 'Lương tháng 10', from: '2026-10-01', to: '2026-10-31', status: 'locked', statusLabel: 'Đã chốt', total: 5_000_000, paid: 1_000_000, remaining: 4_000_000,
      paysheets: [{ id: 21, code: 'PL000021', employeeId: 10, employee: { id: 10, code: 'NV000001', name: 'Lê Thị Bình', position: '' }, base: 4_500_000, overtime: 0, allowance: 300_000, deduction: 0, commission: 200_000, bonus: 0, total: 5_000_000, paid: 1_000_000, note: '', detail: { lines: [] } }] });
    if (path === '/cash-funds') return Promise.resolve([{ id: 1, type: 'cash', name: 'Tiền mặt' }, { id: 2, type: 'bank', name: 'VCB' }]);
    if (path === '/product-groups') return Promise.resolve([{ id: 5, name: 'Phụ kiện', parentId: null, productCount: 3 }]);
    if (path === '/products/lookup') return Promise.resolve([{ productId: 9, unitId: null, code: 'NA009', name: 'Cà vạt lụa', unitName: '', conversion: 1, price: 250_000, onHand: 3 }]);
    return Promise.resolve({ id: 1 });
  });
});

test('paying a paysheet posts the remaining amount and the chosen fund', async () => {
  renderWithQuery(<PayrollPeriodView id={4} onBack={() => undefined} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Thanh toán Lê Thị Bình' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Số tiền trả')).toHaveValue('4,000,000');
  fireEvent.change(within(dialog).getByLabelText('Quỹ'), { target: { value: '2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Trả lương' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/paysheets/21/pay')?.[1].body).toEqual({ amount: 4_000_000, fundId: 2 }));
});

test('the commission rule editor saves product and group rules', async () => {
  const onSaved = vi.fn();
  renderWithQuery(<CommissionTableForm table={null} onClose={onSaved} />);
  fireEvent.change(screen.getByLabelText('Tên bảng hoa hồng'), { target: { value: 'Hoa hồng phụ kiện' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm theo nhóm hàng' }));
  await screen.findByRole('option', { name: 'Phụ kiện' });
  fireEvent.change(screen.getByLabelText('Nhóm hàng của dòng 1'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Mức của dòng 1'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm theo hàng hóa' }));
  fireEvent.change(screen.getByPlaceholderText('Tìm hàng hóa'), { target: { value: 'NA009' } });
  fireEvent.click(await screen.findByRole('button', { name: /Cà vạt lụa/ }));
  fireEvent.change(screen.getByLabelText('Loại của dòng 2'), { target: { value: 'fixed' } });
  fireEvent.change(screen.getByLabelText('Mức của dòng 2'), { target: { value: '20000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/commission-tables')?.[1].body).toEqual({
    name: 'Hoa hồng phụ kiện', isActive: true, rules: [{ scope: 'group', refId: 5, type: 'percent', value: 5 }, { scope: 'product', refId: 9, type: 'fixed', value: 20_000 }],
  }));
});
