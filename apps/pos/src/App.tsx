import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from './lib/api';
import { db } from './lib/db';
import { enqueue, getMeta, listQueue, removeFromQueue, retryItem, setMeta, syncQueue, type QueueItem } from './lib/sync';
import { printHtml, receiptHtml, type ReceiptData } from './lib/print';
import type { Bootstrap, PosCustomer } from './lib/types';
import { loadCarts, newCart, saveCarts, type CatalogProduct, type Cart } from './state/carts';
import { PosScreen, type SubmitResult } from './components/PosScreen';
import { OrdersDialog } from './components/OrdersDialog';
import { CloseShiftDialog, OpenShiftDialog, type Shift } from './components/ShiftDialogs';
import { Modal } from './components/ui';

type Catalog = { serverTime: string; products: CatalogProduct[] };

function toCartLine(l: { productId: number; unitId: number | null; qty: number; price: number; discount: number; note: string; productCode: string; productName: string; unit: string }, cat: CatalogProduct[]) {
  const p = cat.find(x => x.id === l.productId);
  return { key: `${l.productId}:${l.unitId ?? 0}`, productId: l.productId, unitId: l.unitId, conversion: p?.units.find(u => u.id === l.unitId)?.conversion ?? 1, code: l.productCode, name: l.productName, unitName: l.unit, groupId: p?.groupId ?? null, qty: l.qty, price: l.price, listPrice: l.price, discount: l.discount, note: l.note, loyaltyEnabled: p?.loyaltyEnabled ?? true, fixedPoints: p?.points ?? null, imageUrl: p?.imageUrl ?? null };
}

async function syncCatalog(): Promise<CatalogProduct[]> {
  const d = await db();
  const since = await getMeta<string>('catalogSince');
  const r = await api<Catalog>('/pos/catalog', { query: { since } });
  const tx = d.transaction('products', 'readwrite');
  for (const p of r.products) await tx.store.put(p);
  await tx.done;
  await setMeta('catalogSince', r.serverTime);
  return (await d.getAll('products')) as CatalogProduct[];
}
async function syncCustomers(): Promise<PosCustomer[]> {
  const d = await db();
  const since = await getMeta<string>('customersSince');
  const r = await api<{ serverTime: string; customers: PosCustomer[] }>('/pos/customers', { query: { since } });
  const tx = d.transaction('customers', 'readwrite');
  for (const c of r.customers) await tx.store.put(c);
  await tx.done;
  await setMeta('customersSince', r.serverTime);
  return (await d.getAll('customers')) as PosCustomer[];
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [carts, setCarts] = useState<Awaited<ReturnType<typeof loadCarts>> | null | undefined>(undefined);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [askShift, setAskShift] = useState(false);
  const [closeShift, setCloseShift] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [loadRequest, setLoadRequest] = useState<{ cart: Cart; extras?: object } | null>(null);
  const [fatal, setFatal] = useState('');
  const bootRef = useRef<Bootstrap | null>(null);

  const refreshQueue = useCallback(async () => setQueue(await listQueue()), []);
  const runSync = useCallback(async () => {
    if (!navigator.onLine) return;
    await syncQueue(sale => api('/invoices', { body: sale })).catch(() => undefined);
    await refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    (async () => {
      setCarts((await loadCarts()) ?? null);
      try {
        const b = await api<Bootstrap>('/pos/bootstrap');
        await setMeta('bootstrap', b);
        setBoot(b); bootRef.current = b;
        const [cat, cust] = await Promise.all([syncCatalog(), syncCustomers()]);
        setCatalog(cat); setCustomers(cust);
        await handleLoadRequest(cat, cust);
        const s = await api<Shift | null>('/shifts/current').catch(() => null);
        setShift(s);
        if (!s) setAskShift(true);
      } catch (e) {
        const cached = await getMeta<Bootstrap>('bootstrap');
        if (!cached) { setFatal(e instanceof ApiError ? e.message : 'Không tải được dữ liệu bán hàng. Kiểm tra kết nối mạng.'); return; }
        setBoot(cached); bootRef.current = cached;
        setCatalog((await (await db()).getAll('products')) as CatalogProduct[]);
        setCustomers((await (await db()).getAll('customers')) as PosCustomer[]);
      }
      await refreshQueue();
    })();
    const up = () => { setOnline(true); void runSync(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const timer = setInterval(() => { void runSync(); }, 30_000);
    const refresh = setInterval(async () => {
      if (!navigator.onLine) return;
      try { setCatalog(await syncCatalog()); setCustomers(await syncCustomers()); } catch { /* keep cache */ }
    }, 5 * 60_000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(timer); clearInterval(refresh); };
  }, [refreshQueue, runSync]);

  /** Requests handed over by the admin app ("Sao chép", "Lập hóa đơn"). */
  async function handleLoadRequest(cat: CatalogProduct[], cust: PosCustomer[]) {
    let req: { type: 'copy'; invoiceId: number } | { type: 'order'; orderId: number } | null = null;
    try { req = JSON.parse(localStorage.getItem('pd.pos.load') ?? 'null'); localStorage.removeItem('pd.pos.load'); } catch { /* ignore */ }
    if (!req) return;
    if (req.type === 'order') return loadOrder(req.orderId, cat, cust);
    const d = await api<{ customerId: number | null; priceBookId: number | null; note: string; lines: { productId: number; unitId: number | null; qty: number; price: number; discount: number; note: string; productCode: string; productName: string; unit: string }[] }>(`/invoices/${req.invoiceId}/copy`);
    setLoadRequest({ cart: { ...newCart(0, 'Sao chép'), customerId: d.customerId, priceBookId: d.priceBookId, note: d.note, lines: d.lines.map(l => toCartLine(l, cat)) }, extras: { customer: cust.find(c => c.id === d.customerId) ?? null } });
  }

  async function printInvoice(id: number) {
    const b = bootRef.current!;
    const d = await api<ReceiptData & { qrPayload: string | null }>(`/invoices/${id}/print`);
    const qrDataUrl = d.qrPayload ? await QRCode.toDataURL(d.qrPayload, { margin: 1, width: 240 }) : null;
    printHtml(receiptHtml({ ...d, qrDataUrl }, b.settings.pos.receiptTemplate));
  }

  async function submit(input: object, cart: Cart): Promise<SubmitResult> {
    const b = bootRef.current!;
    const label = cart.label;
    if (!navigator.onLine) {
      const item = await enqueue(input as never, label);
      await refreshQueue();
      return { code: `Hóa đơn tạm ${item.clientUuid.slice(0, 8)}`, offline: true };
    }
    const clientUuid = crypto.randomUUID();
    try {
      const inv = await api<{ id: number; code: string }>('/invoices', { body: { ...input, clientUuid } });
      if (b.settings.pos.printAfterPayment) printInvoice(inv.id).catch(() => undefined);
      setCatalog(await syncCatalog().catch(() => catalog));
      if (cart.customerId) setCustomers(await syncCustomers().catch(() => customers));
      return inv;
    } catch (e) {
      // A real rejection (4xx) goes back to the cashier; a server hiccup is treated like a network failure.
      if (e instanceof ApiError && e.status < 500 && ![408, 429].includes(e.status)) throw e;
      // Network failure mid-request: queue with the same uuid so a server that did save it won't double-post.
      const item = await enqueue(input as never, label);
      await (await db()).put('queue', { ...item, clientUuid, sale: { ...item.sale, clientUuid } });
      await removeFromQueue(item.clientUuid);
      await refreshQueue();
      return { code: `Hóa đơn tạm ${clientUuid.slice(0, 8)}`, offline: true };
    }
  }

  async function loadOrder(id: number, cat = catalog, cust = customers) {
    const d = await api<{ orderId: number; orderCode: string; customerId: number | null; depositAvailable: number; lines: { productId: number; unitId: number | null; qty: number; price: number; discount: number; productCode: string; productName: string; unit: string }[] }>(`/customer-orders/${id}/invoice-draft`);
    const cart: Cart = {
      ...newCart(0, d.orderCode), customerId: d.customerId, orderId: d.orderId,
      lines: d.lines.map(l => toCartLine({ ...l, note: '' }, cat)),
    };
    setLoadRequest({ cart, extras: { depositAvailable: d.depositAvailable, customer: cust.find(c => c.id === d.customerId) ?? null } });
  }

  if (fatal) return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><p>{fatal}</p><a className="btn-primary" href="/login?next=/sale/">Đăng nhập</a></div>;
  if (!boot || carts === undefined) return <div className="flex h-full items-center justify-center text-slate-500">Đang tải dữ liệu bán hàng...</div>;

  const pending = queue.filter(q => q.status === 'pending').length;
  const failed = queue.filter(q => q.status === 'error').length;
  const status = (
    <button type="button" onClick={() => setQueueOpen(true)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${failed ? 'bg-rose-500' : pending || !online ? 'bg-amber-500 text-slate-900' : 'bg-white/20'}`}>
      {failed ? `Lỗi đồng bộ (${failed})` : !online ? `Mất kết nối – ${pending} hóa đơn chờ` : pending ? `Đang chờ gửi ${pending}` : 'Đã đồng bộ'}
    </button>
  );
  const menu = (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden text-right leading-tight lg:block">{boot.user.fullName}<span className="block text-xs opacity-80">{boot.branch.name}</span></span>
      {shift ? <button type="button" className="btn-ghost" onClick={() => setCloseShift(true)}>Kết ca</button> : <button type="button" className="btn-ghost" onClick={() => setAskShift(true)}>Mở ca</button>}
      <a className="btn-ghost" href="/dashboard">Quản lý</a>
    </div>
  );
  return (
    <>
      <PosScreen boot={boot} catalog={catalog} customers={customers} online={online} initial={carts ?? undefined} onCartsChange={s => { void saveCarts(s); }}
        onSubmit={submit} onSubmitExchange={async body => { const r = await api<{ code: string; exchangeInvoice?: { id: number; code: string } }>('/returns', { body }); if (r.exchangeInvoice) printInvoice(r.exchangeInvoice.id).catch(() => undefined); setCatalog(await syncCatalog().catch(() => catalog)); return { code: `${r.code} / ${r.exchangeInvoice?.code ?? ''}` }; }}
        checkVoucher={(code, total) => api('/vouchers/check', { query: { code, total } })}
        status={status} menu={menu} openOrder={() => setOrdersOpen(true)} loadRequest={loadRequest} />
      <OrdersDialog open={ordersOpen} onClose={() => setOrdersOpen(false)} onReprint={id => { void printInvoice(id); }} onLoadOrder={id => { void loadOrder(id); }} />
      <OpenShiftDialog open={askShift} onSkip={() => setAskShift(false)} onOpened={s => { setShift(s); setAskShift(false); }} />
      <CloseShiftDialog shift={closeShift ? shift : null} onClose={() => setCloseShift(false)} onClosed={() => { setShift(null); setCloseShift(false); }} />
      <Modal open={queueOpen} wide title="Hóa đơn chờ đồng bộ" onClose={() => setQueueOpen(false)}
        footer={<button type="button" className="btn-primary" disabled={!online} onClick={() => { void runSync(); }}>Đồng bộ ngay</button>}>
        {!queue.length && <p className="text-slate-500">Không có hóa đơn chờ.</p>}
        {queue.map(q => (
          <div key={q.clientUuid} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm">
            <span><b>{q.label}</b> · {new Date(q.createdAt).toLocaleString('vi-VN')}{q.error && <span className="block text-rose-600">{q.error}</span>}</span>
            <span className="flex gap-1">
              {q.status === 'error' && <button type="button" className="btn" onClick={async () => { await retryItem(q.clientUuid); await refreshQueue(); }}>Gửi lại</button>}
              {q.status === 'error' && <button type="button" className="btn" onClick={async () => {
                // Restore everything the cashier entered (order, delivery, discounts, points, voucher); payments are re-entered at checkout.
                const sale = q.sale;
                const cart: Cart = {
                  ...newCart(0, q.label), customerId: sale.customerId ?? null, priceBookId: sale.priceBookId ?? null, orderId: sale.orderId ?? null, channel: sale.channel ?? 'store',
                  invoiceDiscount: sale.invoiceDiscount ?? 0, pointsUsed: sale.pointsUsed ?? 0, voucherCode: sale.voucherCode ?? '', otherIncome: sale.otherIncome ?? 0, note: sale.note ?? '',
                  mode: sale.delivery ? 'delivery' : 'normal', delivery: sale.delivery ?? null,
                  lines: sale.lines.map(l => {
                    const p = catalog.find(x => x.id === l.productId);
                    const u = p?.units.find(x => x.id === l.unitId);
                    return { key: `${l.productId}:${l.unitId ?? 0}`, productId: l.productId, unitId: l.unitId, conversion: u?.conversion ?? 1, code: u?.code ?? p?.code ?? '', name: p?.name ?? '', unitName: u?.name ?? p?.unit ?? '', groupId: p?.groupId ?? null, qty: l.qty, price: l.price, listPrice: l.price, discount: l.discount, note: l.note, loyaltyEnabled: p?.loyaltyEnabled ?? true, fixedPoints: p?.points ?? null, imageUrl: p?.imageUrl ?? null };
                  }),
                };
                setLoadRequest({ cart }); await removeFromQueue(q.clientUuid); await refreshQueue(); setQueueOpen(false);
              }}>Sửa</button>}
              <button type="button" className="btn text-rose-600" onClick={async () => { await removeFromQueue(q.clientUuid); await refreshQueue(); }}>Bỏ</button>
            </span>
          </div>
        ))}
      </Modal>
    </>
  );
}
