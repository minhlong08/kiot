import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';
import { buildVietQrPayload, formatVnd, type PaymentMethod } from '@pd/shared';
import type { Cart, Delivery } from '../state/carts';
import type { Bootstrap, PosCustomer } from '../lib/types';
import { previewSale, type Payment } from '../lib/saleInput';
import { MoneyField, Row } from './ui';

const METHODS: { method: PaymentMethod; label: string }[] = [
  { method: 'cash', label: 'Tiền mặt' }, { method: 'transfer', label: 'Chuyển khoản' }, { method: 'card', label: 'Thẻ' }, { method: 'ewallet', label: 'Ví điện tử' },
];
const emptyDelivery = (c: PosCustomer | null): Delivery => ({ receiverName: c?.name ?? '', receiverPhone: c?.phone ?? '', address: '', ward: '', province: '', partnerId: null, fee: 0, cod: 0, weight: 0, note: '' });

type Props = {
  boot: Bootstrap; cart: Cart; customer: PosCustomer | null; exchangeCredit: number; depositAvailable: number;
  onChange: (patch: Partial<Cart>) => void; onClose: () => void; onPay: (payments: Payment[]) => Promise<void>; busy: boolean;
  checkVoucher: (code: string, total: number) => Promise<{ valid: boolean; discount?: number; reason?: string }>;
};

export function PaymentPanel({ boot, cart, customer, exchangeCredit, depositAvailable, onChange, onClose, onPay, busy, checkVoucher }: Props) {
  const defaultFund = (m: PaymentMethod) => (m === 'cash' ? null : boot.settings.pos.defaultFundIds[m as 'transfer' | 'card' | 'ewallet'] ?? boot.funds.find(f => (m === 'ewallet' ? f.type === 'ewallet' : f.type === 'bank'))?.id ?? null);
  const base = previewSale(cart, boot, customer, [], exchangeCredit);
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, number>>>({ cash: Math.max(0, base.due - exchangeCredit), ...(depositAvailable ? { deposit: Math.min(depositAvailable, base.due) } : {}) });
  const [funds, setFunds] = useState<Partial<Record<PaymentMethod, number | null>>>({});
  const [voucher, setVoucher] = useState(cart.voucherCode);
  const [voucherMsg, setVoucherMsg] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [percent, setPercent] = useState(false);
  const payments: Payment[] = (Object.entries(amounts) as [PaymentMethod, number][])
    .sort(([a], [b]) => ['deposit', 'cash', 'transfer', 'card', 'ewallet'].indexOf(a) - ['deposit', 'cash', 'transfer', 'card', 'ewallet'].indexOf(b))
    .map(([method, amount]) => ({ method, amount, fundId: funds[method] !== undefined ? funds[method]! : defaultFund(method) }));
  const r = previewSale(cart, boot, customer, payments, exchangeCredit);
  const delivery = cart.delivery ?? emptyDelivery(customer);
  const setDelivery = (p: Partial<Delivery>) => onChange({ delivery: { ...delivery, ...p } });
  const bank = boot.settings.pos.bankQr;
  const transfer = amounts.transfer ?? 0;

  useEffect(() => {
    if (!transfer || !bank.bankBin || !bank.accountNumber) { setQr(null); return; }
    QRCode.toDataURL(buildVietQrPayload({ bankBin: bank.bankBin, accountNumber: bank.accountNumber, amount: transfer, description: 'Thanh toan don hang' }), { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [transfer, bank.bankBin, bank.accountNumber]);
  useEffect(() => { if (cart.mode === 'delivery' && !cart.delivery) onChange({ delivery: emptyDelivery(customer) }); }, [cart.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickCash = useMemo(() => {
    const due = Math.max(0, r.due - (amounts.transfer ?? 0) - (amounts.card ?? 0) - (amounts.ewallet ?? 0) - (amounts.deposit ?? 0));
    return [...new Set([due, ...[10_000, 50_000, 100_000, 500_000].map(s => Math.ceil(due / s) * s)])].filter(v => v >= due).slice(0, 5);
  }, [r.due, amounts]);

  async function applyVoucher() {
    if (!voucher.trim()) { onChange({ voucherCode: '', voucherDiscount: 0 }); setVoucherMsg(''); return; }
    const v: { valid: boolean; discount?: number; reason?: string } = await checkVoucher(voucher.trim(), r.subtotal - r.promoInvoiceDiscount - cart.invoiceDiscount).catch(() => ({ valid: false, reason: 'Cần kết nối mạng để kiểm tra voucher' }));
    if (v.valid) { onChange({ voucherCode: voucher.trim().toUpperCase(), voucherDiscount: v.discount ?? 0 }); setVoucherMsg(`Giảm ${formatVnd(v.discount ?? 0)}`); }
    else { onChange({ voucherCode: '', voucherDiscount: 0 }); setVoucherMsg(v.reason ?? 'Voucher không hợp lệ'); }
  }

  const listTotal = cart.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const deliveryOk = cart.mode !== 'delivery' || (delivery.receiverName && delivery.receiverPhone && delivery.address);
  return (
    <div data-testid="payment-panel" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-white shadow-2xl">
      <div className="flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
        <h2 className="font-semibold">Thanh toán {customer ? `· ${customer.name}` : '· Khách lẻ'}</h2>
        <button type="button" aria-label="Đóng thanh toán" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
        <Row label={`Tổng tiền hàng (${cart.lines.reduce((s, l) => s + l.qty, 0)})`}>{formatVnd(r.subtotal)}</Row>
        <Row label={<span className="flex items-center gap-2">Giảm giá <button type="button" className="rounded bg-slate-100 px-1.5 text-xs" onClick={() => setPercent(p => !p)}>{percent ? '%' : 'VND'}</button></span>}>
          <MoneyField className="w-36" aria-label="Giảm giá hóa đơn" value={percent ? Math.round((cart.invoiceDiscount * 100) / Math.max(1, r.subtotal)) : cart.invoiceDiscount}
            onChange={v => onChange({ invoiceDiscount: percent ? Math.round((r.subtotal * Math.min(v, 100)) / 100) : Math.min(v, r.subtotal) })} />
        </Row>
        {boot.user.maxDiscountPercent < 100 && cart.invoiceDiscount + cart.lines.reduce((s, l) => s + l.discount, 0) > (listTotal * Math.max(boot.user.maxDiscountPercent, customer?.discountPercent ?? 0)) / 100 && (
          <p className="text-xs text-rose-600">Giảm giá vượt mức cho phép ({Math.max(boot.user.maxDiscountPercent, customer?.discountPercent ?? 0)}%)</p>
        )}
        {r.applied.length > 0 && <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">{r.applied.map(a => <div key={a.promotionId}>🎁 {a.name}: -{formatVnd(a.amount)}</div>)}{r.gifts.length > 0 && <div>Kèm quà tặng</div>}</div>}
        <Row label="Mã voucher"><span className="flex gap-1"><input className="input w-28 uppercase" aria-label="Mã voucher" value={voucher} onChange={e => setVoucher(e.target.value)} /><button type="button" className="btn" onClick={applyVoucher}>Áp dụng</button></span></Row>
        {voucherMsg && <p className="text-right text-xs text-slate-600">{voucherMsg}</p>}
        {customer && customer.points > 0 && (
          <Row label={`Điểm (còn ${formatVnd(customer.points)})`}><MoneyField className="w-28" aria-label="Điểm sử dụng" value={cart.pointsUsed} onChange={v => onChange({ pointsUsed: Math.min(v, customer.points) })} /></Row>
        )}
        <Row label="Thu khác"><MoneyField className="w-36" aria-label="Thu khác" value={cart.otherIncome} onChange={v => onChange({ otherIncome: v })} /></Row>
        {r.roundingAdjust !== 0 && <Row label="Làm tròn">{formatVnd(r.roundingAdjust)}</Row>}
        {exchangeCredit > 0 && <Row label="Tiền hàng trả (đổi hàng)">-{formatVnd(exchangeCredit)}</Row>}
        <Row label="Khách cần trả" strong testId="due">{formatVnd(r.due)}</Row>

        <div className="flex flex-wrap gap-1 pt-2">
          {METHODS.map(m => (
            <button key={m.method} type="button" onClick={() => setAmounts(a => (a[m.method] !== undefined && m.method !== 'cash' ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== m.method)) : { ...a, [m.method]: a[m.method] ?? 0 }))}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${amounts[m.method] !== undefined ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-300'}`}>{m.label}</button>
          ))}
        </div>
        {depositAvailable > 0 && <Row label={`Tiền cọc (còn ${formatVnd(depositAvailable)})`}><MoneyField className="w-36" aria-label="Số tiền Tiền cọc" value={amounts.deposit ?? 0} onChange={v => setAmounts(a => ({ ...a, deposit: Math.min(v, depositAvailable) }))} /></Row>}
        {METHODS.filter(m => amounts[m.method] !== undefined).map(m => (
          <div key={m.method} className="space-y-1 rounded border border-slate-200 p-2">
            <Row label={m.label}><MoneyField className="w-36" aria-label={`Số tiền ${m.label}`} value={amounts[m.method] ?? 0} onChange={v => setAmounts(a => ({ ...a, [m.method]: v }))} /></Row>
            {m.method !== 'cash' && (
              <select className="input py-1 text-xs" aria-label={`Tài khoản ${m.label}`} value={(funds[m.method] !== undefined ? funds[m.method] : defaultFund(m.method)) ?? ''} onChange={e => setFunds(f => ({ ...f, [m.method]: e.target.value ? Number(e.target.value) : null }))}>
                {boot.funds.filter(f => f.type !== 'cash').map(f => <option key={f.id} value={f.id}>{f.name}{f.accountNumber ? ` - ${f.accountNumber}` : ''}</option>)}
              </select>
            )}
            {m.method === 'cash' && <div className="flex flex-wrap gap-1">{quickCash.map(v => <button key={v} type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs" onClick={() => setAmounts(a => ({ ...a, cash: v }))}>{formatVnd(v)}</button>)}</div>}
            {m.method === 'transfer' && qr && <div className="flex justify-center"><img src={qr} alt="VietQR" className="h-44 w-44" /></div>}
          </div>
        ))}
        <Row label="Khách thanh toán">{formatVnd(r.paid)}</Row>
        <Row label="Tiền thừa trả khách" testId="change">{formatVnd(r.change)}</Row>
        {r.nonCashOverpay && <p className="text-xs text-rose-600">Chuyển khoản/thẻ vượt số cần trả</p>}
        {cart.mode !== 'delivery' && r.debt > 0 && <Row label={customer ? 'Tính vào công nợ' : 'Còn thiếu'}><span className="text-rose-700">{formatVnd(r.debt)}</span></Row>}

        {cart.mode === 'delivery' && (
          <div className="mt-2 space-y-2 rounded border border-sky-200 bg-sky-50 p-2">
            <div className="text-sm font-semibold text-sky-900">Thông tin giao hàng</div>
            <label className="block"><span className="label">Người nhận</span><input className="input" aria-label="Người nhận" value={delivery.receiverName} onChange={e => setDelivery({ receiverName: e.target.value })} /></label>
            <label className="block"><span className="label">SĐT nhận</span><input className="input" aria-label="SĐT nhận" value={delivery.receiverPhone} onChange={e => setDelivery({ receiverPhone: e.target.value })} /></label>
            <label className="block"><span className="label">Địa chỉ giao</span><input className="input" aria-label="Địa chỉ giao" value={delivery.address} onChange={e => setDelivery({ address: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Phí giao (trả đối tác)</span><MoneyField value={delivery.fee} aria-label="Phí giao" onChange={fee => setDelivery({ fee })} /></label>
              <label><span className="label">Trọng lượng (g)</span><MoneyField value={delivery.weight} aria-label="Trọng lượng" onChange={weight => setDelivery({ weight })} /></label>
            </div>
            <Row label="Thu hộ (COD)">{formatVnd(r.debt)}</Row>
          </div>
        )}
        <label className="block pt-2"><span className="label">Ghi chú</span><input className="input" value={cart.note} onChange={e => onChange({ note: e.target.value })} /></label>
      </div>
      <div className="border-t border-slate-200 p-3">
        <button type="button" className="w-full rounded-md bg-accent-500 py-3 text-lg font-bold text-slate-900 hover:bg-accent-400 disabled:opacity-50"
          disabled={busy || !cart.lines.length || r.nonCashOverpay || !deliveryOk || (!customer && cart.mode !== 'delivery' && r.debt > 0)} onClick={() => onPay(payments)}>THANH TOÁN</button>
      </div>
    </div>
  );
}
