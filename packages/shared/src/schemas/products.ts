import { z } from 'zod';
import { moneySchema } from './common';

export const PRODUCT_TYPES = ['goods', 'service', 'combo'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

const qty = z.number().int().min(0).max(999_999_999);
const optText = (max = 2000) => z.string().trim().max(max).default('');
const optCode = z.string().trim().max(40).optional().transform(v => v || undefined);

export const productUnitInputSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1, 'Nhập tên đơn vị'),
  conversion: z.number().int().min(2, 'Giá trị quy đổi phải lớn hơn 1'),
  code: optCode,
  barcode: optCode,
  price: moneySchema,
  isDirectSale: z.boolean().default(true),
});

export const variantInputSchema = z.object({
  id: z.number().int().optional(),
  values: z.array(z.string().trim().min(1)).min(1),
  code: optCode,
  barcode: optCode,
  price: moneySchema,
  cost: moneySchema.default(0),
  onHand: qty.optional(),
});

export const productInputSchema = z.object({
  code: optCode,
  barcode: optCode,
  name: z.string().trim().min(1, 'Tên hàng là bắt buộc').max(250),
  type: z.enum(PRODUCT_TYPES).default('goods'),
  groupId: z.number().int().nullable().optional(),
  brandId: z.number().int().nullable().optional(),
  locationId: z.number().int().nullable().optional(),
  price: moneySchema.default(0),
  cost: moneySchema.default(0),
  onHand: qty.optional(),
  minStock: qty.default(0),
  maxStock: qty.default(999_999_999),
  weight: z.number().int().min(0).max(10_000_000).default(0),
  unit: optText(30),
  description: optText(20000),
  note: optText(),
  orderNoteTemplate: optText(),
  vatRate: z.number().int().min(0).max(100).nullable().optional(),
  loyaltyEnabled: z.boolean().default(true),
  points: z.number().int().min(0).nullable().optional(),
  isDirectSale: z.boolean().default(true),
  sellOnline: z.boolean().default(false),
  allBranches: z.boolean().default(true),
  branchIds: z.array(z.number().int()).default([]),
  images: z.array(z.string().max(500)).max(10, 'Tối đa 10 ảnh').default([]),
  units: z.array(productUnitInputSchema).default([]),
  attributes: z.array(z.object({ name: z.string().trim().min(1), values: z.array(z.string().trim().min(1)) })).default([]),
  variants: z.array(variantInputSchema).default([]),
  comboItems: z.array(z.object({ itemId: z.number().int(), qty: z.number().int().min(1) })).default([]),
  warranties: z.array(z.object({
    kind: z.enum(['warranty', 'maintenance']),
    name: z.string().trim().min(1),
    duration: z.number().int().min(1),
    durationUnit: z.enum(['day', 'month', 'year']),
  })).default([]),
}).superRefine((p, ctx) => {
  if (p.type !== 'service' && !p.groupId) ctx.addIssue({ code: 'custom', path: ['groupId'], message: 'Chọn nhóm hàng' });
  if (p.type === 'combo' && !p.comboItems.length) ctx.addIssue({ code: 'custom', path: ['comboItems'], message: 'Combo cần ít nhất một hàng thành phần' });
  if (p.minStock > p.maxStock) ctx.addIssue({ code: 'custom', path: ['maxStock'], message: 'Định mức tồn cao nhất phải lớn hơn thấp nhất' });
  if (!p.allBranches && !p.branchIds.length) ctx.addIssue({ code: 'custom', path: ['branchIds'], message: 'Chọn chi nhánh kinh doanh' });
});

export type ProductInput = z.infer<typeof productInputSchema>;
