import type { Tx } from '../db';

type Book = { id: number; name: string; isActive: boolean; startAt: Date | null; endAt: Date | null; branchIds: string; customerGroupIds: string; userIds: string; allowOutsideItems: boolean };

const ids = (json: string): number[] => {
  try { return JSON.parse(json) as number[]; } catch { return []; }
};

/** Empty scope list means "all". */
export function bookApplies(b: Book, ctx: { branchId: number; userId: number; customerGroupId?: number | null; at: Date }) {
  if (!b.isActive) return false;
  if (b.startAt && ctx.at < b.startAt) return false;
  if (b.endAt && ctx.at > b.endAt) return false;
  const branches = ids(b.branchIds), groups = ids(b.customerGroupIds), users = ids(b.userIds);
  if (branches.length && !branches.includes(ctx.branchId)) return false;
  if (users.length && !users.includes(ctx.userId)) return false;
  if (groups.length && (!ctx.customerGroupId || !groups.includes(ctx.customerGroupId))) return false;
  return true;
}

export async function applicablePriceBooks(tx: Tx, ctx: { branchId: number; userId: number; customerGroupId?: number | null; at: Date }) {
  const books = await tx.priceBook.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return books.filter(b => bookApplies(b, ctx));
}

/** The price in a book, falling back to the product's base price. */
export async function priceFor(tx: Tx, productId: number, priceBookId: number | null): Promise<number> {
  if (priceBookId) {
    const item = await tx.priceBookItem.findUnique({ where: { priceBookId_productId: { priceBookId, productId } } });
    if (item) return item.price;
  }
  return (await tx.product.findUniqueOrThrow({ where: { id: productId } })).price;
}
