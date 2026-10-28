import { expect, test } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataTable, type Column } from '../src/components/list/DataTable';
import { Pagination } from '../src/components/list/Pagination';

type Row = { id: number; code: string; name: string; price: number };
const rows: Row[] = [
  { id: 1, code: 'NA001', name: 'Áo vest nam', price: 1_000_000 },
  { id: 2, code: 'NA002', name: 'Quần âu nam', price: 500_000 },
];
const columns: Column<Row>[] = [
  { key: 'code', header: 'Mã hàng', sortable: true },
  { key: 'name', header: 'Tên hàng' },
  { key: 'price', header: 'Giá bán', money: true, total: true, align: 'right' },
];

function Harness() {
  const [selected, setSelected] = useState<(string | number)[]>([]);
  return (
    <>
      <DataTable tableId="t" columns={columns} rows={rows} getRowId={r => r.id} totals={{ price: 1_500_000 }}
        selected={selected} onSelectedChange={setSelected}
        renderExpanded={r => <div>Chi tiết {r.code}</div>} />
      <output data-testid="sel">{selected.join(',')}</output>
    </>
  );
}

test('renders the totals row with a formatted sum', () => {
  render(<Harness />);
  expect(screen.getByTestId('totals-row')).toHaveTextContent('1,500,000');
});

test('money cells are formatted', () => {
  render(<Harness />);
  expect(screen.getByText('1,000,000')).toBeInTheDocument();
});

test('clicking a row toggles its expanded detail', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('NA001'));
  expect(screen.getByText('Chi tiết NA001')).toBeInTheDocument();
  fireEvent.click(screen.getByText('NA001'));
  expect(screen.queryByText('Chi tiết NA001')).not.toBeInTheDocument();
});

test('header checkbox selects all visible rows', () => {
  render(<Harness />);
  fireEvent.click(screen.getByLabelText('Chọn tất cả'));
  expect(screen.getByTestId('sel')).toHaveTextContent('1,2');
});

test('row checkbox does not expand the row', () => {
  render(<Harness />);
  fireEvent.click(screen.getAllByLabelText('Chọn dòng')[0]);
  expect(screen.queryByText('Chi tiết NA001')).not.toBeInTheDocument();
  expect(screen.getByTestId('sel')).toHaveTextContent('1');
});

test('hiding a column via the column chooser removes its header', () => {
  render(<Harness />);
  fireEvent.click(screen.getByTitle('Ẩn/hiện cột'));
  fireEvent.click(within(screen.getByTestId('column-chooser')).getByLabelText('Tên hàng'));
  expect(screen.queryByRole('columnheader', { name: 'Tên hàng' })).not.toBeInTheDocument();
});

test('sortable header cycles sort', () => {
  let sort: string | undefined;
  render(<DataTable tableId="s" columns={columns} rows={rows} getRowId={r => r.id} sort={undefined} onSortChange={s => { sort = s; }} />);
  fireEvent.click(screen.getByRole('columnheader', { name: /Mã hàng/ }));
  expect(sort).toBe('code:asc');
});

test('pagination shows the range text', () => {
  render(<Pagination page={1} pageSize={15} total={40} noun="hàng hóa" onChange={() => {}} />);
  expect(screen.getByText('1 - 15 trong 40 hàng hóa')).toBeInTheDocument();
});

test('empty state', () => {
  render(<DataTable tableId="e" columns={columns} rows={[]} getRowId={r => r.id} />);
  expect(screen.getByText('Không tìm thấy kết quả nào phù hợp')).toBeInTheDocument();
});
