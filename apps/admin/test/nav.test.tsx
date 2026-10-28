import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MainNav } from '../src/layout/MainNav';

test('mega-menu shows permitted items and hides forbidden modules', () => {
  render(<MainNav can={p => p !== 'cashbook.view'} currentPath="/dashboard" renderLink={(to, label) => <a href={to}>{label}</a>} />);
  fireEvent.mouseEnter(screen.getByText('Hàng hóa'));
  for (const label of ['Danh sách hàng hóa', 'Thiết lập giá', 'Kiểm kho', 'Chuyển hàng']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
  expect(screen.queryByText('Sổ quỹ')).not.toBeInTheDocument();
});

test('Mua hàng menu lists purchase orders and receipts', () => {
  render(<MainNav can={() => true} currentPath="/dashboard" renderLink={(to, label) => <a href={to}>{label}</a>} />);
  fireEvent.mouseEnter(screen.getByText('Mua hàng'));
  expect(screen.getByText('Đặt hàng nhập').closest('a')).toHaveAttribute('href', '/purchase-orders');
  expect(screen.getByText('Nhập hàng').closest('a')).toHaveAttribute('href', '/purchase-receipts');
});
