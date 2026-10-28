import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PosScreen } from '../src/components/PosScreen';
import { boot, tie, vest, vip } from './fixtures';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

const setup = (o: Partial<Parameters<typeof PosScreen>[0]> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue({ code: 'HD000001' });
  render(<PosScreen boot={boot()} catalog={[vest, tie]} customers={[vip]} online onSubmit={onSubmit} {...o} />);
  return { onSubmit, search: screen.getByPlaceholderText('Tìm hàng hóa (F3)') };
};
const scan = (input: HTMLElement, code: string) => { fireEvent.change(input, { target: { value: code } }); fireEvent.keyDown(input, { key: 'Enter' }); };

test('scanning the same barcode twice increments the quantity', () => {
  const { search } = setup();
  scan(search, '893');
  scan(search, '893');
  expect(screen.getByLabelText('Số lượng NA001')).toHaveValue('2');
});

test('choosing a customer of a price-book group switches to that price book', async () => {
  const { search } = setup();
  scan(search, '893');
  fireEvent.change(screen.getByPlaceholderText('Tìm khách hàng (F4)'), { target: { value: 'Mai' } });
  fireEvent.click(await screen.findByText('Chị Mai'));
  expect(screen.getByLabelText('Bảng giá')).toHaveValue('2');
  expect(screen.getByTestId('line-NA001')).toHaveTextContent('900,000');
});

test('an active product promotion shows on the line', () => {
  const promo = { id: 9, code: 'KM9', name: 'Vest -10%', type: 'productDiscount' as const, productIds: [1], groupIds: [], minQty: 1, value: 10, unit: '%' as const, combinable: false, startAt: null, endAt: null, daysOfWeek: [], hours: [], branchIds: [], customerGroupIds: [] };
  render(<PosScreen boot={boot({ promotions: [promo] })} catalog={[vest]} customers={[]} online onSubmit={vi.fn()} />);
  scan(screen.getByPlaceholderText('Tìm hàng hóa (F3)'), '893');
  expect(screen.getByTestId('line-NA001')).toHaveTextContent('Vest -10%');
  expect(screen.getByTestId('total-due')).toHaveTextContent('900,000');
});

test('F9 opens payment; split cash + transfer gives change only from cash and shows VietQR', async () => {
  const { search, onSubmit } = setup();
  scan(search, '893');
  fireEvent.keyDown(window, { key: 'F9' });
  expect(within(await screen.findByTestId('payment-panel')).getByText('Khách cần trả')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển khoản' }));
  fireEvent.change(screen.getByLabelText('Số tiền Chuyển khoản'), { target: { value: '300,000' } });
  fireEvent.change(screen.getByLabelText('Số tiền Tiền mặt'), { target: { value: '800,000' } });
  expect(screen.getByTestId('change')).toHaveTextContent('100,000');
  expect(await screen.findByAltText('VietQR')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'THANH TOÁN' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0].payments).toEqual([{ method: 'cash', amount: 800_000, fundId: null }, { method: 'transfer', amount: 300_000, fundId: 2 }]);
});

test('delivery mode posts receiver details', async () => {
  const { search, onSubmit } = setup();
  scan(search, '894');
  fireEvent.click(screen.getByRole('button', { name: 'Bán giao hàng' }));
  fireEvent.keyDown(window, { key: 'F9' });
  const panel = await screen.findByTestId('payment-panel');
  fireEvent.change(within(panel).getByLabelText('Người nhận'), { target: { value: 'Anh Bình' } });
  fireEvent.change(within(panel).getByLabelText('SĐT nhận'), { target: { value: '0912000111' } });
  fireEvent.change(within(panel).getByLabelText('Địa chỉ giao'), { target: { value: '12 Lê Lợi' } });
  fireEvent.change(screen.getByLabelText('Số tiền Tiền mặt'), { target: { value: '0' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'THANH TOÁN' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0].delivery).toMatchObject({ receiverName: 'Anh Bình', receiverPhone: '0912000111', address: '12 Lê Lợi' });
});

test('a second tab keeps its own cart', () => {
  const { search } = setup();
  scan(search, '893');
  fireEvent.click(screen.getByRole('button', { name: 'Thêm hóa đơn' }));
  expect(screen.queryByTestId('line-NA001')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Hóa đơn 1/ }));
  expect(screen.getByTestId('line-NA001')).toBeInTheDocument();
});

test('when the store requires a customer, checkout is blocked until one is chosen', async () => {
  const b = boot();
  b.settings.orders.requireCustomer = true;
  const { search } = setup({ boot: b });
  scan(search, '893');
  fireEvent.keyDown(window, { key: 'F9' });
  const panel = await screen.findByTestId('payment-panel');
  expect(within(panel).getByRole('button', { name: 'THANH TOÁN' })).toBeDisabled();
  expect(within(panel).getByText('Cần chọn khách hàng')).toBeInTheDocument();
});

test('F1 shows the shortcut help; F8 reprints the last receipt', async () => {
  const onReprintLast = vi.fn();
  setup({ onReprintLast });
  fireEvent.keyDown(window, { key: 'F1' });
  const help = await screen.findByRole('dialog', { name: 'Phím tắt' });
  expect(within(help).getByText('F9')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'F8' });
  expect(onReprintLast).toHaveBeenCalled();
});
