import { z } from 'zod';

export const MAX_MONEY = 2_000_000_000;
export const moneySchema = z.number().int().min(0).max(MAX_MONEY, 'Giá trị quá lớn');
export const signedMoneySchema = z.number().int().min(-MAX_MONEY, 'Giá trị quá lớn').max(MAX_MONEY, 'Giá trị quá lớn');

export const PAGE_SIZES = [15, 20, 30, 50, 100] as const;
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(n => (PAGE_SIZES as readonly number[]).includes(n), 'pageSize').default(15),
  search: z.string().optional(),
  sort: z.string().regex(/^[\w.]+:(asc|desc)$/).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListResult<T> = { items: T[]; total: number; totals?: Record<string, number> };
