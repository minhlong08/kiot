import { expect, test, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../src/lib/api', () => ({ api: (...a: unknown[]) => apiMock(...a) }));

import { DocumentLinesEditor, type DocLine } from '../src/components/docs/DocumentLinesEditor';

apiMock.mockResolvedValue([{ productId: 5, unitId: null, code: 'NA001', barcode: '8930001', name: 'Áo vest', unitName: 'cái', conversion: 1, price: 1_000, cost: 500, onHand: 9 }]);

function Harness() {
  const [lines, setLines] = useState<DocLine[]>([]);
  return <DocumentLinesEditor lines={lines} onChange={setLines} qtyKey="qty" columns={[{ key: 'qty', header: 'Số lượng', kind: 'qty' }]} newLine={r => ({ qty: 1, onHand: r.onHand ?? 0 })} />;
}

test('scanning the same barcode twice increments the quantity', async () => {
  render(<Harness />);
  const input = screen.getByPlaceholderText('Tìm hàng hóa theo mã hoặc tên (F3)');
  for (let i = 0; i < 2; i++) {
    fireEvent.change(input, { target: { value: '8930001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByText('Áo vest')).toHaveLength(1));
  }
  await waitFor(() => expect(screen.getByLabelText('Số lượng NA001')).toHaveValue('2'));
});
