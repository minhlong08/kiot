import type { Tx } from '../db';
import { AppError, notFound } from '../lib/errors';

export type LoyaltyEntry = { customerId: number; points: number; docType: string; docId: number; docCode: string; note?: string; at?: Date; allowNegative?: boolean };

/** The only writer of customer points. Redemptions below zero are refused unless explicitly allowed (reversals). */
export async function postLoyalty(tx: Tx, e: LoyaltyEntry): Promise<{ balanceAfter: number }> {
  const c = await tx.customer.findUnique({ where: { id: e.customerId } });
  if (!c) throw notFound('Khách hàng');
  if (!e.points) return { balanceAfter: c.points };
  if (e.points < 0 && !e.allowNegative) {
    const r = await tx.customer.updateMany({ where: { id: c.id, points: { gte: -e.points } }, data: { points: { increment: e.points } } });
    if (r.count !== 1) throw new AppError(409, 'INSUFFICIENT_POINTS', `Khách hàng chỉ còn ${c.points} điểm`);
  } else {
    await tx.customer.update({ where: { id: c.id }, data: { points: { increment: e.points } } });
  }
  const balanceAfter = (await tx.customer.findUniqueOrThrow({ where: { id: c.id } })).points;
  await tx.loyaltyTransaction.create({ data: { customerId: c.id, points: e.points, balanceAfter, docType: e.docType, docId: e.docId, docCode: e.docCode, note: e.note ?? '', ...(e.at ? { createdAt: e.at } : {}) } });
  return { balanceAfter };
}

export async function reverseLoyaltyDocument(tx: Tx, docType: string, docId: number, cancelDocType: string) {
  const rows = await tx.loyaltyTransaction.findMany({ where: { docType, docId }, orderBy: { id: 'asc' } });
  for (const r of rows) await postLoyalty(tx, { customerId: r.customerId, points: -r.points, docType: cancelDocType, docId, docCode: r.docCode, note: 'Hủy chứng từ', allowNegative: true });
}

export async function recomputePoints(tx: Tx, customerId: number) {
  return (await tx.loyaltyTransaction.aggregate({ _sum: { points: true }, where: { customerId } }))._sum.points ?? 0;
}
