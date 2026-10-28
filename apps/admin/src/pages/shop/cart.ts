import { useSyncExternalStore } from 'react';

export type CartItem = { productId: number; name: string; variant: string; price: number; imageUrl: string | null };
export type CartLine = CartItem & { qty: number };
export type Cart = CartLine[];

const KEY = 'pd.shop.cart';
const EVENT = 'pd-shop-cart';

export function addToCart(cart: Cart, item: CartItem, qty: number): Cart {
  const found = cart.find(l => l.productId === item.productId);
  if (found) return cart.map(l => (l.productId === item.productId ? { ...l, qty: Math.min(99, l.qty + qty) } : l));
  return [...cart, { ...item, qty: Math.min(99, qty) }];
}
export const setQty = (cart: Cart, productId: number, qty: number): Cart =>
  qty <= 0 ? cart.filter(l => l.productId !== productId) : cart.map(l => (l.productId === productId ? { ...l, qty: Math.min(99, qty) } : l));
export const cartCount = (cart: Cart) => cart.reduce((s, l) => s + l.qty, 0);
export const cartTotal = (cart: Cart) => cart.reduce((s, l) => s + l.qty * l.price, 0);

let cached: { raw: string | null; cart: Cart } = { raw: null, cart: [] };
export function loadCart(): Cart {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  if (raw === cached.raw) return cached.cart;
  let cart: Cart = [];
  try { const v = raw ? JSON.parse(raw) : []; if (Array.isArray(v)) cart = v; } catch { /* corrupt: start empty */ }
  cached = { raw, cart };
  return cart;
}
export function saveCart(cart: Cart) {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* storage unavailable: cart lives for this page only */ cached = { raw: JSON.stringify(cart), cart }; }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
};
/** The cart in this browser; persists across visits and tabs. */
export function useCart(): [Cart, (next: Cart) => void] {
  const cart = useSyncExternalStore(subscribe, loadCart, () => []);
  return [cart, saveCart];
}
