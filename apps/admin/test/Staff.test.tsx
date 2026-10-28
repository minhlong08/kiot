import { beforeEach, expect, test, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from './utils';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a), download: vi.fn(), toQueryString: () => '' }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ can: () => true, me: { user: { branchId: 1 } } }) }));

import { SchedulePage } from '../src/pages/staff/SchedulePage';
import { TimesheetsPage } from '../src/pages/staff/TimesheetsPage';

const dt = () => { const data: Record<string, string> = {}; return { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' }; };
const shifts = [{ id: 3, name: 'Ca sáng', start: '08:00', end: '14:00', breakMinutes: 0, color: '#0f766e', isActive: true }];
const employees = [{ id: 10, code: 'NV000001', name: 'Lê Thị Bình', position: 'Thu ngân' }, { id: 11, code: 'NV000002', name: 'Trần Văn Cường', position: '' }];

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === '/schedule') return Promise.resolve({ employees, shifts, entries: [{ id: 50, employeeId: 10, shiftId: 3, date: '2026-10-26' }] });
    if (path === '/work-shifts') return Promise.resolve(shifts);
    if (path === '/employees') return Promise.resolve({ items: employees, total: 2 });
    if (path === '/employees/me') return Promise.resolve(null);
    if (path === '/timesheets') return Promise.resolve({ items: [{ id: null, employeeId: 10, shiftId: 3, date: '2026-10-26', checkIn: null, checkOut: null, status: 'scheduled', late: 0, early: 0, overtime: 0, worked: 0, manual: false, note: '' }] });
    return Promise.resolve({ id: 99 });
  });
});

test('dropping a shift chip on a cell assigns it; dragging an entry to another cell moves it', async () => {
  renderWithQuery(<SchedulePage initialMonday="2026-10-26" />);
  const chip = await screen.findByRole('button', { name: 'Kéo ca Ca sáng' });
  const target = screen.getByTestId('cell-11-2026-10-27');
  const d1 = dt();
  fireEvent.dragStart(chip, { dataTransfer: d1 });
  fireEvent.dragOver(target, { dataTransfer: d1 });
  fireEvent.drop(target, { dataTransfer: d1 });
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/schedule' && c[1]?.body)?.[1].body).toEqual({ employeeId: 11, shiftId: 3, date: '2026-10-27' }));

  const entry = within(screen.getByTestId('cell-10-2026-10-26')).getByText('Ca sáng');
  const d2 = dt();
  fireEvent.dragStart(entry, { dataTransfer: d2 });
  fireEvent.drop(screen.getByTestId('cell-10-2026-10-28'), { dataTransfer: d2 });
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/schedule/move')?.[1].body).toEqual({ id: 50, employeeId: 10, date: '2026-10-28' }));
});

test('editing a timesheet cell posts the times as instants and the status', async () => {
  renderWithQuery(<TimesheetsPage initialMonday="2026-10-26" />);
  fireEvent.click(await screen.findByTestId('ts-10-3-2026-10-26'));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Trạng thái'), { target: { value: 'present' } });
  fireEvent.change(within(dialog).getByLabelText('Giờ vào'), { target: { value: '08:10' } });
  fireEvent.change(within(dialog).getByLabelText('Giờ ra'), { target: { value: '14:30' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(apiMock.mock.calls.find(c => c[0] === '/timesheets' && c[1]?.method === 'PUT')?.[1].body).toEqual({
    employeeId: 10, shiftId: 3, date: '2026-10-26', status: 'present', checkIn: '2026-10-26T01:10:00.000Z', checkOut: '2026-10-26T07:30:00.000Z', note: '',
  }));
});

test('staff without employees.view see and edit-free view their own timesheet', async () => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/employees') return Promise.reject(new Error('Không có quyền'));
    if (path === '/employees/me') return Promise.resolve({ id: 10, code: 'NV000001', name: 'Lê Thị Bình' });
    if (path === '/work-shifts') return Promise.resolve(shifts);
    if (path === '/timesheets') return Promise.resolve({ items: [{ id: 1, employeeId: 10, shiftId: 3, date: '2026-10-26', checkIn: null, checkOut: null, status: 'scheduled', late: 0, early: 0, overtime: 0, worked: 0, manual: false, note: '' }] });
    return Promise.resolve({});
  });
  renderWithQuery(<TimesheetsPage initialMonday="2026-10-26" />);
  expect(await screen.findByText('Lê Thị Bình')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chấm công' })).toBeInTheDocument();
});
