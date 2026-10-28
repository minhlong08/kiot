import { z } from 'zod';
import { normalizePhone } from '../text';

const text = (max = 300) => z.string().trim().max(max).default('');

export const customerInputSchema = z.object({
  code: z.string().trim().max(30).optional().transform(v => v || undefined),
  name: z.string().trim().min(1, 'Tên khách hàng là bắt buộc').max(200),
  phone: text(30).transform(normalizePhone),
  phone2: text(30).transform(normalizePhone),
  email: z.union([z.literal(''), z.string().trim().email('Email không hợp lệ')]).default(''),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh không hợp lệ').nullable().optional(),
  gender: z.enum(['male', 'female', '']).default(''),
  type: z.enum(['person', 'company']).default('person'),
  company: text(200),
  taxCode: text(20),
  address: text(),
  ward: text(100),
  province: text(100),
  groupId: z.number().int().nullable().optional(),
  note: text(1000),
  isActive: z.boolean().default(true),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;
