import { useEffect, useState } from 'react';
import { formatDateTime, formatVnd, parseVnd } from '@pd/shared';
import { api } from '../lib/api';
import { Modal, MoneyField, Row } from './ui';

type InvoiceHit = { id: number; code: string; createdAt: string; customerName: string; total: number; status: string };
type DraftLine = { invoiceLineId: number; productId: number; productCode: string; productName: string; unit: string; soldQty: number; qty: number; price: number };
export type ExchangeStart = { invoiceId: number; invoiceCode: string; customerId: number | null; lines: { invoiceLineId: number; qty: number; name: string; price: number }[]; credit: number };

export function ReturnDialog({ open, onClose, onDone, onExchange }: { open: boolean; onClose: () => void; onDone: (code: string) => void; onExchange: (e: ExchangeStart) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<InvoiceHit[]>([]);
  const [invoice, setInvoice] = useState<{ id: number; code: string; customerId: number | null } | null>(null);
  const [lines, setLines] = useState<(DraftLine & { take: number })[]>([]);
  const [method, setMethod] = useState<'cash' | 'transfer' | 'debt'>('cash');
  const [fee, setFee] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) { setQ(''); setHits([]); setInvoice(null); setLines([]); setError(''); setFee(0); }
  }, [open]);
  useEffect(() => {
    if (!q.trim() || invoice) { setHits([]); return; }
    const t = setTimeout(() => {
      const isCode = /^[a-z]{1,4}\d+$/i.test(q.trim());
      api<{ items: InvoiceHit[] }>('/invoices', { query: { ...(isCode ? { search: q.trim() } : { customer: q.trim() }), status: 'completed', pageSize: 15 } }).then(r => setHits(r.items), () => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, invoice]);

  async function choose(h: InvoiceHit) {
    setError('');
    try {
      const d = await api<{ invoice: { id: number; code: string; customerId: number | null }; lines: DraftLine[] }>(`/invoices/${h.id}/return-draft`);
      setInvoice(d.invoice);
      setLines(d.lines.map(l => ({ ...l, take: 0 })));
    } catch (e) { setError((e as Error).message); }
  }
  const chosen = lines.filter(l => l.take > 0);
  const total = Math.max(0, chosen.reduce((s, l) => s + l.take * l.price, 0) - fee);
  async function submit() {
    try {
      const r = await api<{ code: string }>('/returns', { body: { invoiceId: invoice!.id, refundMethod: method, returnFee: fee, lines: chosen.map(l => ({ invoiceLineId: l.invoiceLineId, qty: l.take })) } });
      onDone(r.code);
      onClose();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <Modal open={open} wide title={invoice ? `Trả hàng · ${invoice.code}` : 'Chọn hóa đơn trả hàng'} onClose={onClose}
      footer={invoice && <>
        <button type="button" className="btn" disabled={!chosen.length} onClick={() => { onExchange({ invoiceId: invoice.id, invoiceCode: invoice.code, customerId: invoice.customerId, credit: total, lines: chosen.map(l => ({ invoiceLineId: l.invoiceLineId, qty: l.take, name: l.productName, price: l.price })) }); onClose(); }}>Đổi hàng</button>
        <button type="button" className="btn-primary" disabled={!chosen.length} onClick={submit}>Trả hàng</button>
      </>}>
      {!invoice && (
        <div className="space-y-2">
          <input className="input" autoFocus placeholder="Mã hóa đơn, tên hoặc SĐT khách" value={q} onChange={e => setQ(e.target.value)} />
          {hits.map(h => (
            <button key={h.id} type="button" onClick={() => choose(h)} className="flex w-full items-center justify-between rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span><b>{h.code}</b><span className="block text-xs text-slate-500">{formatDateTime(h.createdAt)} · {h.customerName}</span></span><span className="num">{formatVnd(h.total)}</span>
            </button>
          ))}
        </div>
      )}
      {invoice && (
        <div className="space-y-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="text-left">Hàng hóa</th><th className="text-right">Đã mua</th><th className="text-right">Giá trả</th><th className="w-24 text-right">SL trả</th></tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.invoiceLineId} className="border-t border-slate-100">
                  <td className="py-1.5">{l.productName}<span className="block text-xs text-slate-500">{l.productCode} · còn trả được {l.qty}</span></td>
                  <td className="num">{l.soldQty}</td><td className="num">{formatVnd(l.price)}</td>
                  <td><input className="input py-1 text-right" aria-label={`Trả ${l.productCode}`} inputMode="numeric" value={String(l.take)}
                    onChange={e => { const v = Math.min(l.qty, Math.max(0, parseVnd(e.target.value))); setLines(ls => ls.map(x => (x.invoiceLineId === l.invoiceLineId ? { ...x, take: v } : x))); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Row label="Phí trả hàng"><MoneyField className="w-36" value={fee} onChange={setFee} aria-label="Phí trả hàng" /></Row>
          <Row label="Cần trả khách" strong>{formatVnd(total)}</Row>
          <Row label="Hoàn tiền bằng">
            <select className="input w-40" value={method} onChange={e => setMethod(e.target.value as typeof method)}>
              <option value="cash">Tiền mặt</option><option value="transfer">Chuyển khoản</option>{invoice.customerId && <option value="debt">Trừ công nợ</option>}
            </select>
          </Row>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Modal>
  );
}
