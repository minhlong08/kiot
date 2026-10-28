import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListToolbar } from '../src/components/list';

test('F2 triggers the primary create action; "/" focuses the search box but not while typing elsewhere', () => {
  const onCreate = vi.fn();
  render(<><input aria-label="khác" /><ListToolbar search="" onSearch={() => undefined} onCreate={onCreate} /></>);
  fireEvent.keyDown(window, { key: 'F2' });
  expect(onCreate).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: '/' });
  expect(screen.getByRole('textbox', { name: 'Tìm kiếm' })).toHaveFocus();
  screen.getByLabelText('khác').focus();
  fireEvent.keyDown(screen.getByLabelText('khác'), { key: '/' });
  expect(screen.getByLabelText('khác')).toHaveFocus();
});

test('without onCreate, F2 clicks the first primary button in the extra actions', () => {
  const click = vi.fn();
  render(<ListToolbar search="" onSearch={() => undefined} extra={<><button type="button" className="btn">Phụ</button><button type="button" className="btn-primary" onClick={click}>Lập phiếu</button></>} />);
  fireEvent.keyDown(window, { key: 'F2' });
  expect(click).toHaveBeenCalled();
});
