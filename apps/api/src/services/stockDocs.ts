import type { Tx } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { docCode, mergeLines } from '../lib/docs';
import { audit, type AuditCtx } from './audit';
import { getSettings } from './settings';
import { adjustCounter, getBranchStock, moveStock, reverseDocument, setOnHand } from './stock';

export type DocCtx = AuditCtx & { branchId: number; userId: number };

async function assertGoods(tx: Tx, ids: number[]) {
  const ps = await tx.product.findMany({ where: { id: { in: ids } } });
  if (ps.length !== new Set(ids).size) throw notFound('Hàng hóa');
  const bad = ps.find(p => p.type !== 'goods');
  if (bad) throw badRequest('NOT_STOCKED', `${bad.code} không phải hàng hóa có tồn kho`);
}

// ───────── Stock take ─────────

export type StockTakeInput = { code?: string; note?: string; lines: { productId: number; actualQty: number }[] };

export async function saveStockTake(tx: Tx, ctx: DocCtx, input: StockTakeInput, id?: number) {
  const lines = mergeLines(input.lines, ['actualQty']);
  await assertGoods(tx, lines.map(l => l.productId));
  const prefix = (await getSettings(tx)).orders.codePrefixes.stockTake;
  let doc;
  if (id) {
    const cur = await tx.stockTake.findUnique({ where: { id } });
    if (!cur) throw notFound('Phiếu kiểm kho');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu tạm');
    await tx.stockTakeLine.deleteMany({ where: { stockTakeId: id } });
    doc = await tx.stockTake.update({ where: { id }, data: { note: input.note ?? cur.note } });
  } else {
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.stockTake.findUnique({ where: { code: c } })));
    doc = await tx.stockTake.create({ data: { code, branchId: ctx.branchId, note: input.note ?? '', createdById: ctx.userId } });
  }
  for (const l of lines) {
    const s = await getBranchStock(tx, l.productId, doc.branchId);
    await tx.stockTakeLine.create({ data: { stockTakeId: doc.id, productId: l.productId, actualQty: l.actualQty, systemQty: s.onHand, diffQty: l.actualQty - s.onHand, cost: s.cost, diffValue: (l.actualQty - s.onHand) * s.cost } });
  }
  await refreshStockTakeTotals(tx, doc.id);
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'StockTake', entityId: doc.id, entityCode: doc.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu kiểm kho ${doc.code}` });
  return doc;
}

async function refreshStockTakeTotals(tx: Tx, id: number) {
  const lines = await tx.stockTakeLine.findMany({ where: { stockTakeId: id } });
  await tx.stockTake.update({
    where: { id },
    data: { totalActualQty: lines.reduce((s, l) => s + l.actualQty, 0), totalDiffQty: lines.reduce((s, l) => s + l.diffQty, 0), totalDiffValue: lines.reduce((s, l) => s + l.diffValue, 0) },
  });
}

/** Balancing recomputes the system quantity at this moment, so sales since the draft are respected. */
export async function balanceStockTake(tx: Tx, ctx: DocCtx, id: number, opts: { zeroMissing?: boolean } = {}) {
  const doc = await tx.stockTake.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound('Phiếu kiểm kho');
  if (doc.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã cân bằng hoặc đã hủy');
  for (const l of doc.lines) {
    const before = await getBranchStock(tx, l.productId, doc.branchId);
    const { diff } = await setOnHand(tx, { productId: l.productId, branchId: doc.branchId, target: l.actualQty, docType: 'stockTake', docId: doc.id, docCode: doc.code });
    await tx.stockTakeLine.update({ where: { id: l.id }, data: { systemQty: before.onHand, diffQty: diff, cost: before.cost, diffValue: diff * before.cost } });
  }
  if (opts.zeroMissing) {
    const listed = doc.lines.map(l => l.productId);
    const others = await tx.branchStock.findMany({ where: { branchId: doc.branchId, productId: { notIn: listed }, onHand: { not: 0 } } });
    for (const s of others) {
      await setOnHand(tx, { productId: s.productId, branchId: doc.branchId, target: 0, docType: 'stockTake', docId: doc.id, docCode: doc.code });
      await tx.stockTakeLine.create({ data: { stockTakeId: doc.id, productId: s.productId, systemQty: s.onHand, actualQty: 0, diffQty: -s.onHand, cost: s.cost, diffValue: -s.onHand * s.cost } });
    }
  }
  await refreshStockTakeTotals(tx, doc.id);
  await tx.stockTake.update({ where: { id }, data: { status: 'balanced', balancedAt: new Date() } });
  await audit(tx, ctx, { action: 'complete', entity: 'StockTake', entityId: id, entityCode: doc.code, summary: `Cân bằng kho ${doc.code}` });
}

export async function cancelStockTake(tx: Tx, ctx: DocCtx, id: number) {
  const doc = await tx.stockTake.findUnique({ where: { id } });
  if (!doc) throw notFound('Phiếu kiểm kho');
  if (doc.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
  if (doc.status === 'balanced') await reverseDocument(tx, 'stockTake', id, 'stockTake_cancel');
  await tx.stockTake.update({ where: { id }, data: { status: 'cancelled' } });
  await audit(tx, ctx, { action: 'cancel', entity: 'StockTake', entityId: id, entityCode: doc.code, summary: `Hủy phiếu kiểm kho ${doc.code}` });
}

// ───────── Write-off / internal use ─────────

export type IssueInput = { kind: 'writeOff' | 'internalUse'; code?: string; reason?: string; note?: string; lines: { productId: number; qty: number }[] };

export async function saveIssue(tx: Tx, ctx: DocCtx, input: IssueInput, id?: number) {
  const lines = mergeLines(input.lines, ['qty']);
  await assertGoods(tx, lines.map(l => l.productId));
  const prefixes = (await getSettings(tx)).orders.codePrefixes;
  let doc;
  if (id) {
    const cur = await tx.stockIssue.findUnique({ where: { id } });
    if (!cur) throw notFound('Phiếu');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu tạm');
    await tx.stockIssueLine.deleteMany({ where: { issueId: id } });
    doc = await tx.stockIssue.update({ where: { id }, data: { reason: input.reason ?? cur.reason, note: input.note ?? cur.note } });
  } else {
    const prefix = input.kind === 'writeOff' ? prefixes.writeOff : prefixes.internalUse;
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.stockIssue.findUnique({ where: { code: c } })));
    doc = await tx.stockIssue.create({ data: { code, kind: input.kind, branchId: ctx.branchId, reason: input.reason ?? '', note: input.note ?? '', createdById: ctx.userId } });
  }
  for (const l of lines) {
    const s = await getBranchStock(tx, l.productId, doc.branchId);
    await tx.stockIssueLine.create({ data: { issueId: doc.id, productId: l.productId, qty: l.qty, cost: s.cost, value: l.qty * s.cost } });
  }
  await tx.stockIssue.update({ where: { id: doc.id }, data: { totalQty: lines.reduce((s, l) => s + l.qty, 0), totalValue: (await tx.stockIssueLine.findMany({ where: { issueId: doc.id } })).reduce((s, l) => s + l.value, 0) } });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'StockIssue', entityId: doc.id, entityCode: doc.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu ${issueLabel(doc.kind)} ${doc.code}` });
  return doc;
}

export const issueLabel = (kind: string) => (kind === 'writeOff' ? 'xuất hủy' : 'xuất dùng nội bộ');

export async function completeIssue(tx: Tx, ctx: DocCtx, id: number) {
  const doc = await tx.stockIssue.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound('Phiếu');
  if (doc.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã hoàn thành hoặc đã hủy');
  let total = 0;
  for (const l of doc.lines) {
    const r = await moveStock(tx, { productId: l.productId, branchId: doc.branchId, qty: -l.qty, docType: doc.kind, docId: doc.id, docCode: doc.code, note: doc.reason });
    total += r.unitCost * l.qty;
    await tx.stockIssueLine.update({ where: { id: l.id }, data: { cost: r.unitCost, value: r.unitCost * l.qty } });
  }
  await tx.stockIssue.update({ where: { id }, data: { status: 'completed', completedAt: new Date(), totalValue: total } });
  await audit(tx, ctx, { action: 'complete', entity: 'StockIssue', entityId: id, entityCode: doc.code, summary: `Hoàn thành phiếu ${issueLabel(doc.kind)} ${doc.code}` });
}

export async function cancelIssue(tx: Tx, ctx: DocCtx, id: number) {
  const doc = await tx.stockIssue.findUnique({ where: { id } });
  if (!doc) throw notFound('Phiếu');
  if (doc.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
  if (doc.status === 'completed') await reverseDocument(tx, doc.kind, id, `${doc.kind}_cancel`);
  await tx.stockIssue.update({ where: { id }, data: { status: 'cancelled' } });
  await audit(tx, ctx, { action: 'cancel', entity: 'StockIssue', entityId: id, entityCode: doc.code, summary: `Hủy phiếu ${issueLabel(doc.kind)} ${doc.code}` });
}

// ───────── Transfers ─────────

export type TransferInput = { code?: string; toBranchId: number; note?: string; lines: { productId: number; qtySent: number }[] };

export async function saveTransfer(tx: Tx, ctx: DocCtx, input: TransferInput, id?: number) {
  if (input.toBranchId === ctx.branchId) throw badRequest('SAME_BRANCH', 'Chi nhánh nhận phải khác chi nhánh chuyển');
  if (!(await tx.branch.findFirst({ where: { id: input.toBranchId, isActive: true } }))) throw notFound('Chi nhánh nhận');
  const lines = mergeLines(input.lines, ['qtySent']);
  await assertGoods(tx, lines.map(l => l.productId));
  const prefix = (await getSettings(tx)).orders.codePrefixes.transfer;
  let doc;
  if (id) {
    const cur = await tx.transfer.findUnique({ where: { id } });
    if (!cur) throw notFound('Phiếu chuyển hàng');
    if (cur.status !== 'draft') throw conflict('NOT_DRAFT', 'Chỉ sửa được phiếu tạm');
    await tx.transferLine.deleteMany({ where: { transferId: id } });
    doc = await tx.transfer.update({ where: { id }, data: { toBranchId: input.toBranchId, note: input.note ?? cur.note } });
  } else {
    const code = await docCode(tx, prefix, input.code, async c => !!(await tx.transfer.findUnique({ where: { code: c } })));
    doc = await tx.transfer.create({ data: { code, fromBranchId: ctx.branchId, toBranchId: input.toBranchId, note: input.note ?? '', createdById: ctx.userId } });
  }
  for (const l of lines) {
    const s = await getBranchStock(tx, l.productId, doc.fromBranchId);
    await tx.transferLine.create({ data: { transferId: doc.id, productId: l.productId, qtySent: l.qtySent, cost: s.cost } });
  }
  await tx.transfer.update({ where: { id: doc.id }, data: { totalSentQty: lines.reduce((s, l) => s + l.qtySent, 0) } });
  await audit(tx, ctx, { action: id ? 'update' : 'create', entity: 'Transfer', entityId: doc.id, entityCode: doc.code, summary: `${id ? 'Cập nhật' : 'Tạo'} phiếu chuyển hàng ${doc.code}` });
  return doc;
}

export async function sendTransfer(tx: Tx, ctx: DocCtx, id: number) {
  const doc = await tx.transfer.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound('Phiếu chuyển hàng');
  if (doc.status !== 'draft') throw conflict('NOT_DRAFT', 'Phiếu đã chuyển hoặc đã hủy');
  let value = 0;
  for (const l of doc.lines) {
    const r = await moveStock(tx, { productId: l.productId, branchId: doc.fromBranchId, qty: -l.qtySent, docType: 'transferOut', docId: doc.id, docCode: doc.code });
    await tx.transferLine.update({ where: { id: l.id }, data: { cost: r.unitCost } });
    await adjustCounter(tx, l.productId, doc.toBranchId, 'incoming', l.qtySent);
    value += r.unitCost * l.qtySent;
  }
  await tx.transfer.update({ where: { id }, data: { status: 'inTransit', sentAt: new Date(), totalValue: value } });
  await audit(tx, ctx, { action: 'complete', entity: 'Transfer', entityId: id, entityCode: doc.code, summary: `Chuyển hàng ${doc.code}` });
}

export async function receiveTransfer(tx: Tx, ctx: DocCtx, id: number, received: { productId: number; qtyReceived: number }[]) {
  const doc = await tx.transfer.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound('Phiếu chuyển hàng');
  if (doc.status !== 'inTransit') throw conflict('NOT_IN_TRANSIT', 'Phiếu không ở trạng thái đang chuyển');
  if (ctx.branchId !== doc.toBranchId) throw badRequest('WRONG_BRANCH', 'Hãy chuyển sang chi nhánh nhận để nhận hàng');
  let total = 0;
  for (const l of doc.lines) {
    const qty = received.find(r => r.productId === l.productId)?.qtyReceived ?? l.qtySent;
    if (qty < 0 || qty > l.qtySent) throw badRequest('INVALID_QTY', 'Số lượng nhận không hợp lệ');
    if (qty) await moveStock(tx, { productId: l.productId, branchId: doc.toBranchId, qty, unitCost: l.cost, docType: 'transferIn', docId: doc.id, docCode: doc.code });
    await adjustCounter(tx, l.productId, doc.toBranchId, 'incoming', -l.qtySent);
    await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: qty } });
    total += qty;
  }
  await tx.transfer.update({ where: { id }, data: { status: 'received', receivedAt: new Date(), totalReceivedQty: total } });
  await audit(tx, ctx, { action: 'complete', entity: 'Transfer', entityId: id, entityCode: doc.code, summary: `Nhận hàng ${doc.code} (${total}/${doc.totalSentQty})` });
}

export async function cancelTransfer(tx: Tx, ctx: DocCtx, id: number) {
  const doc = await tx.transfer.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound('Phiếu chuyển hàng');
  if (doc.status === 'received') throw conflict('TRANSFER_RECEIVED', 'Phiếu đã nhận hàng, không thể hủy');
  if (doc.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
  if (doc.status === 'inTransit') {
    await reverseDocument(tx, 'transferOut', id, 'transferOut_cancel');
    for (const l of doc.lines) await adjustCounter(tx, l.productId, doc.toBranchId, 'incoming', -l.qtySent);
  }
  await tx.transfer.update({ where: { id }, data: { status: 'cancelled' } });
  await audit(tx, ctx, { action: 'cancel', entity: 'Transfer', entityId: id, entityCode: doc.code, summary: `Hủy phiếu chuyển hàng ${doc.code}` });
}
