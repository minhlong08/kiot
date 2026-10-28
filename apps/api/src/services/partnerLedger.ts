import type { Tx } from '../db';
import { AppError } from '../lib/errors';

export type PartnerType = 'supplier' | 'customer';
export type LedgerEntry = { partnerType: PartnerType; partnerId: number; amount: number; docType: string; docId: number; docCode: string; note?: string; at?: Date };

/** Partner tables holding a cached `debt` balance. Customers join in M4. */
async function bumpDebt(tx: Tx, type: PartnerType, id: number, amount: number): Promise<number> {
  if (type === 'supplier') return (await tx.supplier.update({ where: { id }, data: { debt: { increment: amount } } })).debt;
  const t = tx as unknown as { customer?: { update(a: object): Promise<{ debt: number }> } };
  if (!t.customer) throw new AppError(500, 'NO_CUSTOMERS', 'Customer ledger not available');
  return (await t.customer.update({ where: { id }, data: { debt: { increment: amount } } })).debt;
}

/**
 * The only writer of partner debt. amount > 0: the shop owes the supplier more / the customer owes the shop more.
 */
export async function postPartnerLedger(tx: Tx, e: LedgerEntry): Promise<{ balanceAfter: number }> {
  if (!e.amount) {
    const cur = e.partnerType === 'supplier' ? await tx.supplier.findUniqueOrThrow({ where: { id: e.partnerId } }) : null;
    return { balanceAfter: cur?.debt ?? 0 };
  }
  const balanceAfter = await bumpDebt(tx, e.partnerType, e.partnerId, e.amount);
  await tx.partnerLedger.create({
    data: {
      partnerType: e.partnerType, partnerId: e.partnerId, docType: e.docType, docId: e.docId, docCode: e.docCode,
      amount: e.amount, balanceAfter, note: e.note ?? '', ...(e.at ? { createdAt: e.at } : {}),
    },
  });
  return { balanceAfter };
}

/** Replays a document's ledger rows negated (document cancelled). */
export async function reversePartnerDocument(tx: Tx, docType: string, docId: number, cancelDocType: string) {
  const rows = await tx.partnerLedger.findMany({ where: { docType, docId }, orderBy: { id: 'asc' } });
  for (const r of rows) {
    await postPartnerLedger(tx, { partnerType: r.partnerType as PartnerType, partnerId: r.partnerId, amount: -r.amount, docType: cancelDocType, docId, docCode: r.docCode, note: 'Hủy chứng từ' });
  }
}

export async function recomputePartnerBalance(tx: Tx, type: PartnerType, id: number): Promise<number> {
  const s = await tx.partnerLedger.aggregate({ _sum: { amount: true }, where: { partnerType: type, partnerId: id } });
  return s._sum.amount ?? 0;
}
