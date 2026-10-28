import { db } from '../lib/db';

export type CatalogProduct = {
  id: number; code: string; barcode: string | null; name: string; searchText: string; type: string; groupId: number | null; unit: string; price: number;
  loyaltyEnabled: boolean; points: number | null; vatRate: number | null; orderNoteTemplate: string; sellable: boolean; imageUrl: string | null; onHand: number | null;
  units: { id: number; name: string; conversion: number; code: string; barcode: string | null; price: number }[];
  bookPrices: Record<string, number>;
};
export type CartLine = {
  key: string; productId: number; unitId: number | null; conversion: number; code: string; name: string; unitName: string; groupId: number | null;
  qty: number; price: number; listPrice: number; discount: number; note: string; loyaltyEnabled: boolean; fixedPoints: number | null; imageUrl: string | null;
};
export type Delivery = { receiverName: string; receiverPhone: string; address: string; ward: string; province: string; partnerId: number | null; fee: number; cod: number; weight: number; note: string };
export type Cart = {
  id: number; label: string; mode: 'quick' | 'normal' | 'delivery'; customerId: number | null; priceBookId: number | null; sellerId: number | null; channel: string;
  lines: CartLine[]; invoiceDiscount: number; voucherCode: string; voucherDiscount: number; pointsUsed: number; otherIncome: number; note: string;
  orderId: number | null; delivery: Delivery | null;
};

export const newCart = (n: number, label = `Hóa đơn ${n}`): Cart => ({
  id: n, label, mode: 'normal', customerId: null, priceBookId: null, sellerId: null, channel: 'store', lines: [], invoiceDiscount: 0, voucherCode: '', voucherDiscount: 0,
  pointsUsed: 0, otherIncome: 0, note: '', orderId: null, delivery: null,
});

/** Price for a product (or one of its units) under the selected price book. */
export function priceOf(p: CatalogProduct, unitId: number | null, priceBookId: number | null) {
  if (unitId) return p.units.find(u => u.id === unitId)?.price ?? p.price;
  return (priceBookId && p.bookPrices[priceBookId]) ?? p.price;
}

export function addProduct(cart: Cart, p: CatalogProduct, unitId: number | null, priceBookId: number | null, qty = 1): Cart {
  const key = `${p.id}:${unitId ?? 0}`;
  const existing = cart.lines.find(l => l.key === key);
  if (existing) return setQty(cart, key, existing.qty + qty);
  const unit = unitId ? p.units.find(u => u.id === unitId) : null;
  const price = priceOf(p, unitId, priceBookId);
  const line: CartLine = {
    key, productId: p.id, unitId, conversion: unit?.conversion ?? 1, code: unit?.code ?? p.code, name: p.name, unitName: unit?.name ?? p.unit, groupId: p.groupId,
    qty, price, listPrice: price, discount: 0, note: p.orderNoteTemplate, loyaltyEnabled: p.loyaltyEnabled, fixedPoints: p.points, imageUrl: p.imageUrl,
  };
  return { ...cart, lines: [...cart.lines, line] };
}

export function setQty(cart: Cart, key: string, qty: number): Cart {
  if (qty <= 0) return { ...cart, lines: cart.lines.filter(l => l.key !== key) };
  return { ...cart, lines: cart.lines.map(l => (l.key === key ? { ...l, qty, discount: Math.min(l.discount, qty * l.price) } : l)) };
}

export function updateLine(cart: Cart, key: string, patch: Partial<CartLine>): Cart {
  return { ...cart, lines: cart.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) };
}

/** Re-prices every non-unit line when the price book changes (unless the cashier edited the price). */
export function applyPriceBook(cart: Cart, catalog: Map<number, CatalogProduct>, priceBookId: number | null): Cart {
  return {
    ...cart, priceBookId,
    lines: cart.lines.map(l => {
      const p = catalog.get(l.productId);
      if (!p || l.price !== l.listPrice) return l;
      const price = priceOf(p, l.unitId, priceBookId);
      return { ...l, price, listPrice: price };
    }),
  };
}

export type CartsState = { carts: Cart[]; activeId: number };
export async function saveCarts(s: CartsState) { await (await db()).put('carts', s, 'state'); }
export async function loadCarts(): Promise<CartsState | undefined> { return (await (await db()).get('carts', 'state')) as CartsState | undefined; }
