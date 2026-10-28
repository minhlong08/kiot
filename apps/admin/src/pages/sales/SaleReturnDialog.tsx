import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatVnd } from '@pd/shared';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Field, MoneyInput, NumberInput } from '../../components/Field';
import { FundSelect } from '../../components/FundSelect';
import { ProductPicker } from '../../components/docs/ProductPicker';
import { toast, toastError } from '../../components/toast';

type Line = { invoiceLineId?: number; productId: number; unitId: number | null; productCode: string; productName: string; qty: number; max: number; price: number; take: number };

/** Return from an invoice (invoiceId) or a quick return without invoice (invoiceId = 0). */
export function SaleReturnDialog({ invoiceId, onClose }: { invoiceId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState('');
  const [hasCustomer, setHasCustomer] = useState(false);
  const [fee, setFee] = useState(0);
  const [method, setMethod] = useState<'cash' | 'transfer' | 'debt'>('cash');
  const [fundId, setFundId] = useState<number | null>(null);
  useEffect(() => {
    setLines([]); setFee(0); setMethod('cash');
    if (!invoiceId) return;
    api<{ invoice: { code: string; customerId: number | null }; lines: Omit<Line, 'take' | 'max'>[] }>(`/invoices/${invoiceId}/return-draft`).then(d => {
      setCode(d.invoice.code); setHasCustomer(!!d.invoice.customerId);
      setLines(d.lines.map(l => ({ ...l, max: l.qty, take: 0 })));
    }, toastError);
  }, [invoiceId]);
  const chosen = lines.filter(l => l.take > 0);
  const total = Math.max(0, chosen.reduce((s, l) => s + l.take * l.price, 0) - fee);
  async function submit() {
    try {
      const r = await api<{ code: string }>('/returns', { body: { invoiceId: invoiceId || null, returnFee: fee, refundMethod: method, fundId, lines: chosen.map(l => (l.invoiceLineId ? { invoiceLineId: l.invoiceLineId, qty: l.take } : { productId: l.productId, unitId: l.unitId, qty: l.take, price: l.price })) } });
      await Promise.all(['invoices', 'invoice', 'returns', 'products'].map(k => qc.invalidateQueries({ queryKey: [k] })));
      toast(`Đã tạo phiếu trả hàng ${r.code}`);
      onClose();
    } catch (e) { toastError(e); }
  }
  return (
    <Modal open={invoiceId !== null} size="lg" title={invoiceId ? `Trả hàng · ${code}` : 'Trả hàng nhanh (không theo hóa đơn)'} onClose={onClose}
      footer={<button type="button" className="btn-primary" disabled={!chosen.length} onClick={submit}>Trả hàng</button>}>
      {!invoiceId && <div className="mb-3"><ProductPicker onPick={r => setLines(ls => [...ls, { productId: r.productId, unitId: r.unitId, productCode: r.code, productName: r.name, qty: 0, max: 9999, price: r.price, take: 1 }])} /></div>}
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500"><tr><th className="text-left">Hàng hóa</th>{invoiceId ? <th className="text-right">Còn trả được</th> : null}<th className="text-right">Giá trả</th><th className="w-24 text-right">SL trả</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1.5">{l.productName}<span className="block text-xs text-slate-500">{l.productCode}</span></td>
              {invoiceId ? <td className="num">{l.max}</td> : null}
              <td className="num">{invoiceId ? formatVnd(l.price) : <MoneyInput className="w-32" value={l.price} onChange={price => setLines(ls => ls.map((x, j) => (j === i ? { ...x, price } : x)))} />}</td>
              <td><NumberInput value={l.take} onChange={v => setLines(ls => ls.map((x, j) => (j === i ? { ...x, take: Math.min(x.max, Math.max(0, Math.round(v))) } : x)))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Phí trả hàng"><MoneyInput value={fee} onChange={setFee} /></Field>
        <Field label="Hoàn tiền bằng">
          <select className="input" value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option>{hasCustomer && <option value="debt">Trừ công nợ</option>}</select>
        </Field>
        {method !== 'debt' && <Field label="Quỹ"><FundSelect value={fundId} onChange={setFundId} /></Field>}
      </div>
      <div className="mt-3 text-right text-base font-semibold">Cần trả khách: {formatVnd(total)}</div>
    </Modal>
  );
}
