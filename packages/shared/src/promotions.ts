export type PromoBase = {
  id: number; code: string; name: string; combinable: boolean; startAt: string | null; endAt: string | null;
  /** 0 = Sunday … 6 = Saturday (Vietnam time). Empty = every day. */
  daysOfWeek: number[];
  /** [startHour, endHour) in Vietnam time. Empty = all day. */
  hours: [number, number][];
  branchIds: number[];
  customerGroupIds: number[];
};
export type InvoiceDiscount = PromoBase & { type: 'invoiceDiscount'; tiers: { minTotal: number; value: number; unit: '%' | 'VND'; maxDiscount?: number }[] };
export type ProductDiscount = PromoBase & { type: 'productDiscount'; productIds: number[]; groupIds: number[]; minQty: number; value: number; unit: '%' | 'VND' };
export type BuyXGetY = PromoBase & { type: 'buyXGetY'; buyProductIds: number[]; buyQty: number; getProductIds: number[]; getQty: number; getDiscountPercent: number };
export type GiftItem = PromoBase & { type: 'giftItem'; minTotal: number; giftProductId: number; giftQty: number; giftValue: number };
export type Promotion = InvoiceDiscount | ProductDiscount | BuyXGetY | GiftItem;
export type PromotionType = Promotion['type'];

export type CartLine = { key: string; productId: number; groupId: number | null; qty: number; price: number };
export type PromoContext = { at: Date; branchId: number; customerGroupId: number | null };
export type PromoResult = {
  lineDiscounts: Record<string, number>;
  invoiceDiscount: number;
  gifts: { productId: number; qty: number; promotionId: number }[];
  applied: { promotionId: number; name: string; amount: number }[];
};

const VN_OFFSET = 7 * 3600_000;

export function promotionActive(p: PromoBase, ctx: PromoContext): boolean {
  const t = ctx.at.getTime();
  if (p.startAt && t < new Date(p.startAt).getTime()) return false;
  if (p.endAt && t > new Date(p.endAt).getTime()) return false;
  const local = new Date(t + VN_OFFSET);
  if (p.daysOfWeek.length && !p.daysOfWeek.includes(local.getUTCDay())) return false;
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  if (p.hours.length && !p.hours.some(([a, b]) => hour >= a && hour < b)) return false;
  if (p.branchIds.length && !p.branchIds.includes(ctx.branchId)) return false;
  if (p.customerGroupIds.length && (ctx.customerGroupId === null || !p.customerGroupIds.includes(ctx.customerGroupId))) return false;
  return true;
}

const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);

/** Candidate discounts per line from one product-level promotion (before stacking rules). */
function lineCandidates(lines: CartLine[], p: Promotion): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string, amount: number) => { if (amount > 0) out.set(key, (out.get(key) ?? 0) + amount); };
  if (p.type === 'productDiscount') {
    for (const l of lines) {
      const matches = p.productIds.includes(l.productId) || (l.groupId !== null && p.groupIds.includes(l.groupId));
      if (!matches || l.qty < p.minQty) continue;
      const perUnit = p.unit === '%' ? pct(l.price, p.value) : Math.min(p.value, l.price);
      add(l.key, perUnit * l.qty);
    }
  } else if (p.type === 'buyXGetY') {
    const units = (ids: number[]) => lines.filter(l => ids.includes(l.productId)).flatMap(l => Array.from({ length: l.qty }, () => l));
    const buyUnits = units(p.buyProductIds);
    const getUnits = units(p.getProductIds).sort((a, b) => a.price - b.price);
    const overlap = p.buyProductIds.some(id => p.getProductIds.includes(id));
    const discounted = overlap
      ? Math.floor(buyUnits.length / (p.buyQty + p.getQty)) * p.getQty
      : Math.min(Math.floor(buyUnits.length / p.buyQty) * p.getQty, getUnits.length);
    for (const u of getUnits.slice(0, discounted)) add(u.key, pct(u.price, p.getDiscountPercent));
  }
  return out;
}

/**
 * Line-level stacking: each line gets the single best non-combinable promotion plus every combinable one,
 * capped at the line value; `applied` records exactly what each promotion contributed after the cap.
 */
function lineLevel(lines: CartLine[], promos: Promotion[], out: PromoResult) {
  const candidates = promos.filter(p => p.type === 'productDiscount' || p.type === 'buyXGetY').map(p => ({ p, byLine: lineCandidates(lines, p) }));
  const contributed = new Map<number, number>();
  for (const l of lines) {
    const here = candidates.map(c => ({ p: c.p, amount: c.byLine.get(l.key) ?? 0 })).filter(c => c.amount > 0);
    const best = here.filter(c => !c.p.combinable).sort((a, b) => b.amount - a.amount)[0];
    let left = l.price * l.qty;
    for (const c of [...(best ? [best] : []), ...here.filter(c => c.p.combinable)]) {
      const amount = Math.min(c.amount, left);
      if (amount <= 0) continue;
      left -= amount;
      out.lineDiscounts[l.key] = (out.lineDiscounts[l.key] ?? 0) + amount;
      contributed.set(c.p.id, (contributed.get(c.p.id) ?? 0) + amount);
    }
  }
  for (const c of candidates) {
    const amount = contributed.get(c.p.id);
    if (amount) out.applied.push({ promotionId: c.p.id, name: c.p.name, amount });
  }
}

function invoiceAmount(p: InvoiceDiscount | GiftItem, subtotal: number): number {
  if (p.type === 'giftItem') return subtotal >= p.minTotal ? p.giftValue * p.giftQty : -1;
  const tier = [...p.tiers].sort((a, b) => b.minTotal - a.minTotal).find(t => subtotal >= t.minTotal);
  if (!tier) return -1;
  const raw = tier.unit === '%' ? pct(subtotal, tier.value) : tier.value;
  return Math.min(subtotal, tier.maxDiscount ? Math.min(raw, tier.maxDiscount) : raw);
}

/**
 * Line-level promotions first; then invoice-level ones on the discounted subtotal:
 * every combinable one applies, plus the single best non-combinable one.
 */
export function evaluatePromotions(lines: CartLine[], promos: Promotion[], ctx: PromoContext): PromoResult {
  const active = promos.filter(p => promotionActive(p, ctx));
  const out: PromoResult = { lineDiscounts: {}, invoiceDiscount: 0, gifts: [], applied: [] };
  lineLevel(lines, active, out);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty - (out.lineDiscounts[l.key] ?? 0), 0);
  const invoicePromos = active.filter((p): p is InvoiceDiscount | GiftItem => p.type === 'invoiceDiscount' || p.type === 'giftItem')
    .map(p => ({ p, amount: invoiceAmount(p, subtotal) })).filter(x => x.amount >= 0);
  const best = invoicePromos.filter(x => !x.p.combinable).sort((a, b) => b.amount - a.amount)[0];
  const chosen = [...(best ? [best] : []), ...invoicePromos.filter(x => x.p.combinable)];
  let left = subtotal;
  for (const { p, amount } of chosen) {
    if (p.type === 'giftItem') {
      out.gifts.push({ productId: p.giftProductId, qty: p.giftQty, promotionId: p.id });
      out.applied.push({ promotionId: p.id, name: p.name, amount });
      continue;
    }
    // Invoice discounts never exceed what is left to pay; zero-value promotions are not recorded.
    const take = Math.min(amount, left);
    if (take <= 0) continue;
    left -= take;
    out.invoiceDiscount += take;
    out.applied.push({ promotionId: p.id, name: p.name, amount: take });
  }
  return out;
}

export function voucherDiscount(c: { value: number; unit: '%' | 'VND'; maxDiscount: number | null; minOrder: number }, orderTotal: number): number {
  if (orderTotal < c.minOrder || orderTotal <= 0) return 0;
  const raw = c.unit === '%' ? pct(orderTotal, c.value) : c.value;
  return Math.min(orderTotal, c.maxDiscount ? Math.min(raw, c.maxDiscount) : raw);
}
