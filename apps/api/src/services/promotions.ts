import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { moneySchema, promotionActive, voucherDiscount, type Promotion } from '@pd/shared';
import type { Tx } from '../db';
import { AppError, notFound } from '../lib/errors';

const ids = z.array(z.number().int()).default([]);
export const PROMO_CONFIG = {
  invoiceDiscount: z.object({ tiers: z.array(z.object({ minTotal: moneySchema, value: z.number().int().min(1), unit: z.enum(['%', 'VND']), maxDiscount: moneySchema.optional() })).min(1, 'Cần ít nhất một mức') }),
  productDiscount: z.object({ productIds: ids, groupIds: ids, minQty: z.number().int().min(1).default(1), value: z.number().int().min(1), unit: z.enum(['%', 'VND']) }).refine(c => c.productIds.length || c.groupIds.length, 'Chọn hàng hóa hoặc nhóm hàng'),
  buyXGetY: z.object({ buyProductIds: ids.refine(a => a.length > 0, 'Chọn hàng mua'), buyQty: z.number().int().min(1), getProductIds: ids.refine(a => a.length > 0, 'Chọn hàng tặng'), getQty: z.number().int().min(1), getDiscountPercent: z.number().int().min(1).max(100).default(100) }),
  giftItem: z.object({ minTotal: moneySchema, giftProductId: z.number().int(), giftQty: z.number().int().min(1).default(1) }),
} as const;
export type PromoType = keyof typeof PROMO_CONFIG;

type Row = { id: number; code: string; name: string; type: string; isActive: boolean; startAt: Date | null; endAt: Date | null; daysOfWeek: string; hours: string; branchIds: string; customerGroupIds: string; combinable: boolean; config: string };

/** DB row → the shared engine's Promotion shape (gift value filled from the product price). */
export async function toEnginePromotions(tx: Tx, rows: Row[]): Promise<Promotion[]> {
  const giftIds = rows.filter(r => r.type === 'giftItem').map(r => (JSON.parse(r.config) as { giftProductId: number }).giftProductId);
  const gifts = giftIds.length ? await tx.product.findMany({ where: { id: { in: giftIds } }, select: { id: true, price: true } }) : [];
  return rows.map(r => {
    const config = JSON.parse(r.config) as Record<string, unknown>;
    const base = {
      id: r.id, code: r.code, name: r.name, combinable: r.combinable, startAt: r.startAt?.toISOString() ?? null, endAt: r.endAt?.toISOString() ?? null,
      daysOfWeek: JSON.parse(r.daysOfWeek), hours: JSON.parse(r.hours), branchIds: JSON.parse(r.branchIds), customerGroupIds: JSON.parse(r.customerGroupIds),
    };
    const extra = r.type === 'giftItem' ? { giftValue: gifts.find(g => g.id === config.giftProductId)?.price ?? 0 } : {};
    return { ...base, type: r.type, ...config, ...extra } as Promotion;
  });
}

export async function activePromotions(tx: Tx, ctx: { branchId: number; customerGroupId: number | null; at?: Date }) {
  const rows = await tx.promotion.findMany({ where: { isActive: true } });
  const all = await toEnginePromotions(tx, rows);
  const at = ctx.at ?? new Date();
  // Group scope is checked again at evaluation time; here keep promotions that could apply to some customer.
  return all.filter(p => promotionActive({ ...p, customerGroupIds: [], hours: [], daysOfWeek: [] }, { at, branchId: ctx.branchId, customerGroupId: null })
    && (!p.customerGroupIds.length || ctx.customerGroupId === null || p.customerGroupIds.includes(ctx.customerGroupId)));
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newVoucherCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export async function checkVoucher(tx: Tx, code: string, orderTotal: number, at = new Date()) {
  const v = await tx.voucher.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!v) return { valid: false as const, reason: 'Mã voucher không tồn tại' };
  const c = await tx.voucherCampaign.findUniqueOrThrow({ where: { id: v.campaignId } });
  if (!c.isActive || v.status === 'cancelled') return { valid: false as const, reason: 'Voucher đã ngừng áp dụng' };
  if (!c.multiUse && v.status === 'used') return { valid: false as const, reason: 'Voucher đã được sử dụng' };
  if ((c.startAt && at < c.startAt) || (c.endAt && at > c.endAt)) return { valid: false as const, reason: 'Voucher chưa đến hoặc đã hết hạn' };
  const discount = voucherDiscount({ value: c.value, unit: c.unit as '%' | 'VND', maxDiscount: c.maxDiscount, minOrder: c.minOrder }, orderTotal);
  if (!discount) return { valid: false as const, reason: `Đơn hàng tối thiểu ${c.minOrder.toLocaleString('en-US')} đ` };
  return { valid: true as const, discount, campaign: { id: c.id, name: c.name, combinable: c.combinable } };
}

/** Atomic: a single-use voucher flips unused→used in one conditional update, so two tills cannot both use it. */
export async function redeemVoucher(tx: Tx, code: string, invoiceId: number, orderTotal: number) {
  const check = await checkVoucher(tx, code, orderTotal);
  if (!check.valid) throw new AppError(409, check.reason === 'Voucher đã được sử dụng' ? 'VOUCHER_USED' : 'VOUCHER_INVALID', check.reason);
  const c = await tx.voucherCampaign.findUniqueOrThrow({ where: { id: check.campaign.id } });
  const key = code.trim().toUpperCase();
  if (c.multiUse) {
    await tx.voucher.update({ where: { code: key }, data: { usageCount: { increment: 1 }, usedAt: new Date() } });
  } else {
    const r = await tx.voucher.updateMany({ where: { code: key, status: 'unused' }, data: { status: 'used', usedAt: new Date(), usedInvoiceId: invoiceId, usageCount: 1 } });
    if (r.count !== 1) throw new AppError(409, 'VOUCHER_USED', 'Voucher đã được sử dụng');
  }
  return check.discount;
}

export async function releaseVoucher(tx: Tx, code: string, invoiceId: number) {
  const v = await tx.voucher.findUnique({ where: { code } });
  if (!v) throw notFound('Voucher');
  const c = await tx.voucherCampaign.findUniqueOrThrow({ where: { id: v.campaignId } });
  if (c.multiUse) await tx.voucher.update({ where: { code }, data: { usageCount: { decrement: 1 } } });
  else if (v.usedInvoiceId === invoiceId) await tx.voucher.update({ where: { code }, data: { status: 'unused', usedAt: null, usedInvoiceId: null, usageCount: 0 } });
}
