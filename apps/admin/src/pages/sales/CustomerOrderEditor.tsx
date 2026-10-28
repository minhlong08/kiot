import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { toast, toastError } from '../../components/toast';
import { Field, MoneyInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { DocumentLinesEditor, type DocLine } from '../../components/docs/DocumentLinesEditor';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';

export function CustomerOrderEditor() {
  const params = useParams({ strict: false }) as { id?: string };
  const id = params.id && params.id !== 'new' ? Number(params.id) : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<DocLine[]>([]);
  const [f, setF] = useState({ discount: 0, deposit: 0, depositFundId: null as number | null, note: '', expectedAt: '' });
  useEffect(() => {
    if (!id) return;
    api<{ customerId: number | null; customerName: string; discount: number; deposit: number; note: string; lines: Record<string, unknown>[] }>(`/customer-orders/${id}`).then(async d => {
      if (d.customerId) setCustomer((await api<PickedCustomer[]>('/customers/lookup', { query: { q: d.customerName } }))[0] ?? null);
      setLines(d.lines.map(l => ({ ...l, productId: Number(l.productId), code: String(l.productCode), name: String(l.productName), unit: String(l.unit) })));
      setF(x => ({ ...x, discount: d.discount, deposit: d.deposit, note: d.note }));
    }, toastError);
  }, [id]);
  const subtotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.price) - Number(l.discount ?? 0), 0);
  const total = Math.max(0, subtotal - f.discount);
  async function save(confirm: boolean) {
    try {
      const body = { customerId: customer?.id ?? null, discount: f.discount, deposit: f.deposit, depositFundId: f.depositFundId, note: f.note, expectedAt: f.expectedAt ? new Date(`${f.expectedAt}T00:00:00+07:00`).toISOString() : null, confirm, lines: lines.map(l => ({ productId: l.productId, unitId: l.unitId ?? null, qty: Number(l.qty), price: Number(l.price), discount: Number(l.discount ?? 0) })) };
      const o = await api<{ code: string }>(id ? `/customer-orders/${id}` : '/customer-orders', { method: id ? 'PUT' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['customer-orders'] });
      toast(`Đã lưu ${o.code}`);
      navigate({ to: '/customer-orders' });
    } catch (e) { toastError(e); }
  }
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
          <button type="button" className="btn-ghost" aria-label="Quay lại" onClick={() => navigate({ to: '/customer-orders' })}><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-semibold">Đặt hàng</h1>
        </div>
        <DocumentLinesEditor lines={lines} onChange={setLines} qtyKey="qty" allowUnits pos newLine={r => ({ qty: 1, price: r.price, discount: 0 })}
          columns={[{ key: 'qty', header: 'Số lượng', kind: 'qty' }, { key: 'price', header: 'Đơn giá', kind: 'money' }, { key: 'discount', header: 'Giảm giá', kind: 'money' }, { key: 'amount', header: 'Thành tiền', kind: 'readonlyMoney', value: l => Number(l.qty) * Number(l.price) - Number(l.discount ?? 0) }]} />
      </div>
      <aside className="w-full space-y-3 border-l border-slate-200 bg-slate-50 p-4 lg:w-96">
        <CustomerPicker value={customer} onChange={setCustomer} />
        <div className="flex justify-between text-sm"><span>Tổng tiền hàng</span><span>{formatVnd(subtotal)}</span></div>
        <Field label="Giảm giá"><MoneyInput value={f.discount} onChange={discount => setF({ ...f, discount })} /></Field>
        <div className="flex justify-between font-semibold"><span>Tổng cộng</span><span>{formatVnd(total)}</span></div>
        <Field label="Khách đặt cọc"><MoneyInput value={f.deposit} disabled={!customer} onChange={deposit => setF({ ...f, deposit: Math.min(deposit, total) })} /></Field>
        {f.deposit > 0 && <Field label="Quỹ nhận cọc"><FundSelect value={f.depositFundId} onChange={depositFundId => setF({ ...f, depositFundId })} /></Field>}
        <Field label="Ngày giao dự kiến"><input type="date" className="input" value={f.expectedAt} onChange={e => setF({ ...f, expectedAt: e.target.value })} /></Field>
        <Field label="Ghi chú"><textarea className="input" rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn" disabled={!lines.length} onClick={() => save(false)}>Lưu tạm</button>
          <button type="button" className="btn-primary" disabled={!lines.length} onClick={() => save(true)}>Xác nhận đặt hàng</button>
        </div>
      </aside>
    </div>
  );
}
