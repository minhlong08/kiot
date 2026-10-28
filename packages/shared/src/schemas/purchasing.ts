import { z } from 'zod';
import { moneySchema } from './common';

const text = (max = 300) => z.string().trim().max(max).default('');
const optCode = z.string().trim().max(30).optional().transform(v => v || undefined);
const qty = z.number().int().min(1).max(999_999);

export const supplierInputSchema = z.object({
  code: optCode,
  name: z.string().trim().min(1, 'Tên nhà cung cấp là bắt buộc').max(200),
  phone: text(30),
  email: z.union([z.literal(''), z.string().trim().email('Email không hợp lệ')]).default(''),
  taxCode: text(20),
  address: text(),
  company: text(200),
  groupId: z.number().int().nullable().optional(),
  note: text(1000),
  isActive: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const receiptLineSchema = z.object({
  productId: z.number().int(),
  unitId: z.number().int().nullable().optional(),
  qty,
  unitCost: moneySchema,
  discount: moneySchema.default(0),
}).refine(l => l.discount <= l.qty * l.unitCost, { message: 'Giảm giá vượt quá thành tiền', path: ['discount'] });

export const receiptInputSchema = z.object({
  code: optCode,
  supplierId: z.number().int({ message: 'Chọn nhà cung cấp' }),
  purchaseOrderId: z.number().int().nullable().optional(),
  invoiceNo: text(50),
  lines: z.array(receiptLineSchema).min(1, 'Chưa có hàng hóa'),
  discount: moneySchema.default(0),
  otherCosts: moneySchema.default(0),
  paid: moneySchema.default(0),
  fundId: z.number().int().nullable().optional(),
  note: text(1000),
  at: z.string().datetime({ offset: true }).optional(),
  complete: z.boolean().default(false),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export const purchaseOrderInputSchema = z.object({
  code: optCode,
  supplierId: z.number().int({ message: 'Chọn nhà cung cấp' }),
  lines: z.array(receiptLineSchema).min(1, 'Chưa có hàng hóa'),
  discount: moneySchema.default(0),
  expectedAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: text(1000),
  confirm: z.boolean().default(false),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;

export const purchaseReturnInputSchema = z.object({
  code: optCode,
  supplierId: z.number().int({ message: 'Chọn nhà cung cấp' }),
  receiptId: z.number().int().nullable().optional(),
  lines: z.array(z.object({ productId: z.number().int(), unitId: z.number().int().nullable().optional(), qty, price: moneySchema })).min(1, 'Chưa có hàng hóa'),
  discount: moneySchema.default(0),
  refund: moneySchema.default(0),
  fundId: z.number().int().nullable().optional(),
  note: text(1000),
  complete: z.boolean().default(false),
});
export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;
