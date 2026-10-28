import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, RotateCcw, ShoppingBag, X } from 'lucide-react';
import { APP_NAME, formatVnd, type Promotion } from '@pd/shared';
import { addProduct, applyPriceBook, newCart, setQty, updateLine, type Cart, type CartLine, type CartsState, type CatalogProduct } from '../state/carts';
import { previewSale, toInvoiceInput, type Payment } from '../lib/saleInput';
import type { Bootstrap, PosCustomer } from '../lib/types';
import { ProductSearch } from './ProductSearch';
import { CartLines } from './CartLines';
import { RightPanel } from './RightPanel';
import { PaymentPanel } from './PaymentPanel';
import { ReturnDialog, type ExchangeStart } from './ReturnDialog';
import { Row } from './ui';

export type SubmitResult = { code: string; id?: number; offline?: boolean };
type Extras = { exchange?: ExchangeStart; depositAvailable?: number; customer?: PosCustomer | null };

type Props = {
  boot: Bootstrap; catalog: CatalogProduct[]; customers: PosCustomer[]; online: boolean;
  onSubmit: (input: ReturnType<typeof toInvoiceInput>, cart: Cart) => Promise<SubmitResult>;
  onSubmitExchange?: (body: object) => Promise<SubmitResult>;
  checkVoucher?: (code: string, total: number) => Promise<{ valid: boolean; discount?: number; reason?: string }>;
  initial?: CartsState; onCartsChange?: (s: CartsState) => void;
  status?: ReactNode; menu?: ReactNode;
  /** Opens a customer order into a new tab: returns the cart to load. */
  openOrder?: () => void;
  loadRequest?: { cart: Cart; extras?: Extras } | null;
};

function lineTags(promos: Promotion[], applied: number[], l: CartLine) {
  return promos.filter(p => applied.includes(p.id) && (
    (p.type === 'productDiscount' && (p.productIds.includes(l.productId) || (l.groupId !== null && p.groupIds.includes(l.groupId))))
    || (p.type === 'buyXGetY' && p.getProductIds.includes(l.productId)))).map(p => p.name);
}

export function PosScreen({ boot, catalog, customers, online, onSubmit, onSubmitExchange, checkVoucher, initial, onCartsChange, status, menu, openOrder, loadRequest }: Props) {
  const [state, setState] = useState<CartsState>(() => initial ?? { carts: [newCart(1)], activeId: 1 });
  const [extras, setExtras] = useState<Record<number, Extras>>({});
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const catalogMap = useMemo(() => new Map(catalog.map(p => [p.id, p])), [catalog]);
  const cart = state.carts.find(c => c.id === state.activeId) ?? state.carts[0];
  const extra = extras[cart.id] ?? {};
  const customer = extra.customer ?? customers.find(c => c.id === cart.customerId) ?? null;

  useEffect(() => { onCartsChange?.(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCart = useCallback((fn: (c: Cart) => Cart) => setState(s => ({ ...s, carts: s.carts.map(c => (c.id === s.activeId ? fn(c) : c)) })), []);
  const setExtra = (id: number, e: Extras) => setExtras(x => ({ ...x, [id]: { ...x[id], ...e } }));

  function addTab(c?: Cart, e?: Extras) {
    const id = Math.max(0, ...state.carts.map(x => x.id)) + 1;
    const next = c ? { ...c, id } : newCart(id);
    setState(s => ({ carts: [...s.carts, next], activeId: id }));
    if (e) setExtra(id, e);
    return id;
  }
  function closeTab(id: number) {
    setState(s => {
      const carts = s.carts.filter(c => c.id !== id);
      if (!carts.length) return { carts: [newCart(1)], activeId: 1 };
      return { carts, activeId: s.activeId === id ? carts[carts.length - 1].id : s.activeId };
    });
    setExtras(x => { const { [id]: _drop, ...rest } = x; return rest; });
  }
  useEffect(() => { if (loadRequest) addTab(loadRequest.cart, loadRequest.extras); }, [loadRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = previewSale(cart, boot, customer, [], extra.exchange?.credit ?? 0);
  const appliedIds = preview.applied.map(a => a.promotionId);

  function pickCustomer(c: PosCustomer | null) {
    const book = c?.groupId ? boot.priceBooks.find(b => b.customerGroupIds.includes(c.groupId!)) : undefined;
    const current = boot.priceBooks.find(b => b.id === cart.priceBookId);
    const keep = current && (!current.customerGroupIds.length || (c?.groupId && current.customerGroupIds.includes(c.groupId)));
    const priceBookId = book?.id ?? (keep ? cart.priceBookId : null);
    setCart(x => applyPriceBook({ ...x, customerId: c?.id ?? null, pointsUsed: 0, delivery: x.delivery && c ? { ...x.delivery, receiverName: x.delivery.receiverName || c.name, receiverPhone: x.delivery.receiverPhone || c.phone } : x.delivery }, catalogMap, priceBookId));
    setExtra(cart.id, { customer: c });
  }

  async function pay(payments: Payment[]) {
    setBusy(true);
    setMessage(null);
    try {
      const input = toInvoiceInput(cart, payments);
      const r = extra.exchange
        ? await onSubmitExchange!({ invoiceId: extra.exchange.invoiceId, refundMethod: 'exchange', lines: extra.exchange.lines.map(l => ({ invoiceLineId: l.invoiceLineId, qty: l.qty })), exchange: input })
        : await onSubmit(input, cart);
      setPaying(false);
      setMessage({ text: r.offline ? `Đã lưu ${r.code} (chờ đồng bộ khi có mạng)` : `Đã thanh toán ${r.code}` });
      if (state.carts.length > 1 && (extra.exchange || cart.orderId)) closeTab(cart.id);
      else { setCart(c => ({ ...newCart(c.id, c.label), mode: c.mode })); setExtra(cart.id, { exchange: undefined, depositAvailable: undefined, customer: null }); }
      setTimeout(() => searchRef.current?.focus(), 0);
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); customerRef.current?.focus(); }
      else if (e.key === 'F9') { e.preventDefault(); if (cart.lines.length) setPaying(true); }
      else if (e.key === 'F2') { e.preventDefault(); addTab(); }
      else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const i = state.carts.findIndex(c => c.id === state.activeId);
        setState(s => ({ ...s, activeId: s.carts[(i + (e.shiftKey ? -1 : 1) + s.carts.length) % s.carts.length].id }));
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const c = state.carts[Number(e.key) - 1];
        if (c) { e.preventDefault(); setState(s => ({ ...s, activeId: c.id })); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render to read fresh state

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 bg-brand-700 px-3 py-2 text-white">
        <span className="hidden font-semibold lg:block">{APP_NAME}</span>
        <ProductSearch ref={searchRef} catalog={catalog} onPick={(p, unitId) => setCart(c => addProduct(c, p, unitId, c.priceBookId))}
          onEmptyEnter={() => { if (cart.mode === 'quick' && cart.lines.length) void pay([{ method: 'cash', amount: preview.due, fundId: null }]); }} />
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.carts.map(c => (
            <div key={c.id} className={`flex shrink-0 items-center rounded-t-md ${c.id === cart.id ? 'bg-white text-brand-800' : 'bg-white/15'}`}>
              <button type="button" role="tab" aria-selected={c.id === cart.id} className="px-3 py-1.5 text-sm" onClick={() => setState(s => ({ ...s, activeId: c.id }))}>
                {extras[c.id]?.exchange ? `Đổi hàng ${extras[c.id]!.exchange!.invoiceCode}` : c.label}{c.lines.length ? ` (${c.lines.reduce((s, l) => s + l.qty, 0)})` : ''}
              </button>
              {state.carts.length > 1 && <button type="button" aria-label={`Đóng ${c.label}`} className="pr-2" onClick={() => closeTab(c.id)}><X size={12} /></button>}
            </div>
          ))}
          <button type="button" aria-label="Thêm hóa đơn" className="btn-ghost" onClick={() => addTab()}><Plus size={16} /></button>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setReturnOpen(true)} title="Trả hàng"><RotateCcw size={16} /><span className="hidden xl:inline">Trả hàng</span></button>
        {openOrder && <button type="button" className="btn-ghost" onClick={openOrder} title="Đơn hàng"><ShoppingBag size={16} /><span className="hidden xl:inline">Đơn hàng</span></button>}
        {status}
        {menu}
      </header>
      {message && (
        <div className={`flex items-center justify-between px-3 py-1.5 text-sm ${message.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
          <span role="status">{message.text}</span><button type="button" aria-label="Ẩn thông báo" onClick={() => setMessage(null)}><X size={14} /></button>
        </div>
      )}
      {!online && <div className="bg-amber-100 px-3 py-1 text-sm text-amber-900">Mất kết nối – hóa đơn sẽ được lưu và gửi khi có mạng. Voucher không dùng được khi ngoại tuyến.</div>}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col bg-white">
          {extra.exchange && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              Đổi hàng từ <b>{extra.exchange.invoiceCode}</b>: trả {extra.exchange.lines.map(l => `${l.qty} × ${l.name}`).join(', ')} · Tiền hàng trả <b>{formatVnd(extra.exchange.credit)}</b>
            </div>
          )}
          <CartLines cart={cart} preview={preview} canEditPrice={boot.user.canEditPrice || boot.user.isAdmin} promoNames={l => lineTags(boot.promotions, appliedIds, l)}
            onQty={(key, q) => setCart(c => setQty(c, key, q))} onPatch={(key, p) => setCart(c => updateLine(c, key, p))} />
          <div className="border-t border-slate-200 px-3 py-2">
            <input className="input mb-2" placeholder="Ghi chú đơn hàng" value={cart.note} onChange={e => setCart(c => ({ ...c, note: e.target.value }))} />
            <Row label="Tổng tiền hàng">{formatVnd(preview.subtotal)}</Row>
            {preview.promoInvoiceDiscount + cart.invoiceDiscount + cart.voucherDiscount > 0 && <Row label="Giảm giá">-{formatVnd(preview.promoInvoiceDiscount + cart.invoiceDiscount + cart.voucherDiscount)}</Row>}
            <Row label="Khách cần trả" strong testId="total-due">{formatVnd(preview.total)}</Row>
          </div>
        </section>
        <aside className="hidden w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-slate-50 md:flex">
          <RightPanel ref={customerRef} boot={boot} catalog={catalog} customers={customers} customer={customer} priceBookId={cart.priceBookId}
            onCustomer={pickCustomer} onPriceBook={id => setCart(c => applyPriceBook(c, catalogMap, id))} onAdd={p => setCart(c => addProduct(c, p, null, c.priceBookId))} />
          <div className="border-t border-slate-200 p-3">
            <button type="button" className="w-full rounded-md bg-accent-500 py-3 text-lg font-bold text-slate-900 hover:bg-accent-400 disabled:opacity-50" disabled={!cart.lines.length} onClick={() => setPaying(true)}>THANH TOÁN (F9)</button>
          </div>
        </aside>
      </div>
      <footer className="flex items-center gap-1 border-t border-slate-200 bg-white px-3 py-1.5">
        {([['quick', 'Bán nhanh'], ['normal', 'Bán thường'], ['delivery', 'Bán giao hàng']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setCart(c => ({ ...c, mode: m }))}
            className={`rounded px-3 py-1 text-sm ${cart.mode === m ? 'bg-brand-700 text-white' : 'hover:bg-slate-100'}`}>{label}</button>
        ))}
        <span className="flex-1" />
        <span className="text-xs text-slate-500">F3 tìm hàng · F4 khách hàng · F9 thanh toán · F2 thêm hóa đơn · Ctrl+Tab chuyển hóa đơn</span>
      </footer>
      {paying && (
        <PaymentPanel boot={boot} cart={cart} customer={customer} exchangeCredit={extra.exchange?.credit ?? 0} depositAvailable={extra.depositAvailable ?? 0}
          busy={busy} onChange={p => setCart(c => ({ ...c, ...p }))} onClose={() => setPaying(false)} onPay={pay}
          checkVoucher={checkVoucher ?? (async () => ({ valid: false, reason: 'Không kiểm tra được voucher' }))} />
      )}
      <ReturnDialog open={returnOpen} onClose={() => setReturnOpen(false)} onDone={code => setMessage({ text: `Đã tạo phiếu trả hàng ${code}` })}
        onExchange={e => addTab({ ...newCart(0, 'Đổi hàng'), customerId: e.customerId }, { exchange: e, customer: customers.find(c => c.id === e.customerId) ?? null })} />
    </div>
  );
}
