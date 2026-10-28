import { z } from 'zod';
import { moneySchema } from './common';
import { PAYMENT_METHODS } from '../sale';

const qty = z.number().int().min(1).max(99_999);
export const saleLineSchema = z.object({
  productId: z.number().int(), unitId: z.number().int().nullable().default(null), qty, price: moneySchema,
  discount: moneySchema.default(0), note: z.string().max(300).default(''), isGift: z.boolean().default(false),
});
export const deliveryInputSchema = z.object({
  receiverName: z.string().trim().min(1, 'Nhập tên người nhận').max(120), receiverPhone: z.string().trim().min(6, 'Nhập số điện thoại người nhận').max(20),
  address: z.string().trim().min(1, 'Nhập địa chỉ giao hàng').max(300), ward: z.string().max(100).default(''), province: z.string().max(100).default(''),
  partnerId: z.number().int().nullable().default(null), fee: moneySchema.default(0), cod: moneySchema.default(0), weight: z.number().int().min(0).default(0), note: z.string().max(300).default(''),
});
export const invoiceInputSchema = z.object({
  clientUuid: z.string().uuid().optional(),
  customerId: z.number().int().nullable().default(null),
  priceBookId: z.number().int().nullable().default(null),
  sellerId: z.number().int().nullable().default(null),
  channel: z.string().max(40).default('store'),
  lines: z.array(saleLineSchema).min(1, 'Chưa có hàng hóa'),
  invoiceDiscount: moneySchema.default(0),
  voucherCode: z.string().trim().max(20).optional().transform(v => v || undefined),
  pointsUsed: z.number().int().min(0).default(0),
  otherIncome: moneySchema.default(0),
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: moneySchema, fundId: z.number().int().nullable().default(null) })).default([]),
  note: z.string().max(1000).default(''),
  delivery: deliveryInputSchema.nullable().default(null),
  orderId: z.number().int().nullable().default(null),
  /** When the POS saved the sale offline. */
  createdAtClient: z.string().datetime({ offset: true }).optional(),
});
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;
