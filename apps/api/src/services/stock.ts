import { weightedAverageCost } from '@pd/shared';
import type { Tx } from '../db';
import { AppError } from '../lib/errors';
import { getSettings } from './settings';

export type MoveInput = {
  productId: number;
  branchId: number;
  /** Signed quantity in the product's base unit. */
  qty: number;
  /** Inbound only: the unit cost of the goods coming in, which updates the weighted average. */
  unitCost?: number;
  docType: string;
  docId: number;
  docCode: string;
  note?: string;
  at?: Date;
};

export type MoveResult = { unitCost: number; lines: { productId: number; qtyChange: number; unitCost: number }[] };

export async function getBranchStock(tx: Tx, productId: number, branchId: number) {
  const s = await tx.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } });
  return { onHand: s?.onHand ?? 0, cost: s?.cost ?? 0, reserved: s?.reserved ?? 0, incoming: s?.incoming ?? 0 };
}

async function ensureRow(tx: Tx, productId: number, branchId: number, defaultCost: number) {
  return (
    (await tx.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } })) ??
    (await tx.branchStock.create({ data: { productId, branchId, cost: defaultCost } }))
  );
}

/**
 * The only writer of BranchStock.onHand/cost and StockLedger.
 * Services are no-ops; combos move their components; everything else writes one ledger row.
 */
export async function moveStock(tx: Tx, m: MoveInput, opts: { allowNegative?: boolean } = {}): Promise<MoveResult> {
  const product = await tx.product.findUnique({ where: { id: m.productId } });
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Hàng hóa không tồn tại');
  if (product.type === 'service') return { unitCost: product.cost, lines: [] };

  const allowNegative = opts.allowNegative ?? (await getSettings(tx)).products.allowNegativeStock;

  if (product.type === 'combo') {
    const items = await tx.comboItem.findMany({ where: { comboId: product.id } });
    let unitCost = 0;
    const lines: MoveResult['lines'] = [];
    for (const it of items) {
      const r = await moveStock(tx, { ...m, productId: it.itemId, qty: m.qty * it.qty, unitCost: undefined, note: m.note || `Combo ${product.code}` }, { allowNegative });
      unitCost += r.unitCost * it.qty;
      lines.push(...r.lines);
    }
    return { unitCost, lines };
  }

  const row = await ensureRow(tx, product.id, m.branchId, product.cost);
  const inbound = m.qty > 0 && m.unitCost !== undefined;
  const key = { productId: product.id, branchId: m.branchId };
  if (m.qty < 0 && !allowNegative) {
    // Conditional decrement: correct even when several tills sell the last unit at the same time (Postgres too).
    const r = await tx.branchStock.updateMany({ where: { ...key, onHand: { gte: -m.qty } }, data: { onHand: { increment: m.qty } } });
    if (r.count !== 1) {
      const cur = await getBranchStock(tx, product.id, m.branchId);
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Không đủ tồn kho cho ${product.code} - ${product.name} (còn ${cur.onHand})`, { productId: product.id, onHand: cur.onHand });
    }
  } else {
    const cost = inbound ? weightedAverageCost(row.onHand, row.cost, m.qty, m.unitCost!) : row.cost;
    await tx.branchStock.update({ where: { productId_branchId: key }, data: { onHand: { increment: m.qty }, ...(inbound ? { cost } : {}) } });
  }
  const after = await tx.branchStock.findUniqueOrThrow({ where: { productId_branchId: key } });
  const onHand = after.onHand, cost = after.cost;
  const lineCost = inbound ? m.unitCost! : row.cost;

  if (m.qty !== 0) {
    await tx.stockLedger.create({
      data: {
        productId: product.id, branchId: m.branchId, docType: m.docType, docId: m.docId, docCode: m.docCode,
        qtyChange: m.qty, unitCost: lineCost, balanceAfter: onHand, costAfter: cost, note: m.note ?? '',
        ...(m.at ? { createdAt: m.at } : {}),
      },
    });
  }
  return { unitCost: lineCost, lines: m.qty ? [{ productId: product.id, qtyChange: m.qty, unitCost: lineCost }] : [] };
}

/** Sets on-hand to `target` (stock take). Returns the applied difference. */
export async function setOnHand(tx: Tx, m: Omit<MoveInput, 'qty' | 'unitCost'> & { target: number }) {
  const { onHand } = await getBranchStock(tx, m.productId, m.branchId);
  const diff = m.target - onHand;
  const r = await moveStock(tx, { ...m, qty: diff }, { allowNegative: true });
  return { diff, unitCost: r.unitCost };
}

/** Reserved (customer orders) and incoming (purchase orders, transfers) counters; not part of the ledger. */
export async function adjustCounter(tx: Tx, productId: number, branchId: number, field: 'reserved' | 'incoming', delta: number) {
  if (!delta) return;
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product || product.type === 'service') return;
  if (product.type === 'combo') {
    for (const it of await tx.comboItem.findMany({ where: { comboId: productId } })) {
      await adjustCounter(tx, it.itemId, branchId, field, delta * it.qty);
    }
    return;
  }
  await ensureRow(tx, productId, branchId, product.cost);
  await tx.branchStock.update({ where: { productId_branchId: { productId, branchId } }, data: { [field]: { increment: delta } } });
}

/**
 * Cancels a completed document by replaying its ledger rows negated.
 * Inbound rows reverse at the recorded unit cost, so the average is unwound as closely as the ledger allows.
 */
export async function reverseDocument(tx: Tx, docType: string, docId: number, cancelDocType: string, allowNegative = true) {
  const rows = await tx.stockLedger.findMany({ where: { docType, docId }, orderBy: { id: 'asc' } });
  for (const r of rows) {
    const row = await tx.branchStock.findUniqueOrThrow({ where: { productId_branchId: { productId: r.productId, branchId: r.branchId } } });
    const onHand = row.onHand - r.qtyChange;
    if (onHand < 0 && !allowNegative) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Không đủ tồn kho để hủy chứng từ');
    }
    // Undo an inbound receipt's effect on the average: remove its value from the stock value.
    let cost = row.cost;
    if (r.qtyChange > 0 && onHand > 0) {
      cost = Math.max(0, Math.round((Math.max(row.onHand, 0) * row.cost - r.qtyChange * r.unitCost) / onHand));
    }
    await tx.branchStock.update({ where: { productId_branchId: { productId: r.productId, branchId: r.branchId } }, data: { onHand, cost } });
    await tx.stockLedger.create({
      data: { productId: r.productId, branchId: r.branchId, docType: cancelDocType, docId, docCode: r.docCode, qtyChange: -r.qtyChange, unitCost: r.unitCost, balanceAfter: onHand, costAfter: cost, note: 'Hủy chứng từ' },
    });
  }
}
