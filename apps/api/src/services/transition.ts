import type { Tx } from '../db';
import { AppError } from '../lib/errors';

type DocModel = 'invoice' | 'saleReturn' | 'customerOrder' | 'purchaseReceipt' | 'purchaseReturn' | 'purchaseOrder' | 'stockTake' | 'stockIssue' | 'transfer';

/**
 * Optimistic status change: succeeds only if the document is still in one of `from`.
 * Two clicks, two tills or a replayed request can therefore never post the same document twice.
 */
export async function transition(tx: Tx, model: DocModel, id: number, from: string[], to: string, data: Record<string, unknown> = {}) {
  const repo = tx[model] as unknown as { updateMany(a: object): Promise<{ count: number }> };
  const r = await repo.updateMany({ where: { id, status: { in: from } }, data: { ...data, status: to } });
  if (r.count !== 1) throw new AppError(409, 'STATE_CHANGED', 'Chứng từ đã được cập nhật bởi thao tác khác, vui lòng tải lại');
}
