import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user, hasPerm } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { withProductInfo } from '../lib/docs';
import {
  balanceStockTake, cancelIssue, cancelStockTake, cancelTransfer, completeIssue, receiveTransfer, saveIssue, saveStockTake,
  saveTransfer, sendTransfer, type DocCtx,
} from '../services/stockDocs';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const ctxOf = (req: FastifyRequest): DocCtx => { const u = user(req); return { ...req.auditCtx, branchId: u.branchId, userId: u.id }; };
const qty = z.number().int().min(0).max(999_999);
const pid = z.number().int();
const takeLine = z.object({ productId: pid, actualQty: qty });
const issueLine = z.object({ productId: pid, qty: qty.min(1) });
const sentLine = z.object({ productId: pid, qtySent: qty.min(1) });
const receivedLine = z.object({ productId: pid, qtyReceived: qty });
const code = z.string().trim().max(30).optional().transform(v => v || undefined);

function commonWhere(q: Record<string, unknown>, dateField: string) {
  const from = dateParam(q.from), to = dateParam(q.to);
  const statuses = listParam(q.status);
  return {
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(typeof q.search === 'string' && q.search.trim() ? { code: { contains: q.search.trim().toUpperCase() } } : {}),
    ...(from || to ? { [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
}

async function names(app: FastifyInstance) {
  const [branches, users] = await Promise.all([app.prisma.branch.findMany(), app.prisma.user.findMany({ select: { id: true, fullName: true } })]);
  return { branch: (id: number) => branches.find(b => b.id === id)?.name ?? '', user: (id: number) => users.find(u => u.id === id)?.fullName ?? '' };
}

export async function stockTakeRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const input = z.object({ code, note: z.string().max(1000).optional(), lines: z.array(takeLine).min(1, 'Chưa có hàng hóa'), balance: z.boolean().default(false), zeroMissing: z.boolean().default(false) });

  async function detail(id: number) {
    const d = await db.stockTake.findUnique({ where: { id }, include: { lines: true } });
    if (!d) throw notFound('Phiếu kiểm kho');
    const n = await names(app);
    return { ...d, branchName: n.branch(d.branchId), createdByName: n.user(d.createdById), lines: await withProductInfo(db, d.lines) };
  }

  const where = (req: FastifyRequest): Prisma.StockTakeWhereInput => ({ branchId: user(req).branchId, ...commonWhere(req.query as Record<string, unknown>, 'createdAt') });

  app.get('/api/stock-takes', { preHandler: requirePermission('stockTakes.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([
      db.stockTake.findMany({ where: w, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }),
      db.stockTake.count({ where: w }),
      db.stockTake.aggregate({ where: w, _sum: { totalActualQty: true, totalDiffQty: true, totalDiffValue: true } }),
    ]);
    const n = await names(app);
    return { items: rows.map(r => ({ ...r, branchName: n.branch(r.branchId), createdByName: n.user(r.createdById) })), total, totals: { totalActualQty: sums._sum.totalActualQty ?? 0, totalDiffQty: sums._sum.totalDiffQty ?? 0, totalDiffValue: sums._sum.totalDiffValue ?? 0 } };
  });
  app.get('/api/stock-takes/export', { preHandler: requirePermission('stockTakes.export', 'stockTakes.view') }, async (req, reply) => {
    const rows = await db.stockTake.findMany({ where: where(req), orderBy: { id: 'desc' } });
    return sendXlsx(reply, 'kiem-kho.xlsx', [
      { header: 'Mã kiểm kho', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Trạng thái', key: 'status' },
      { header: 'SL thực tế', key: 'totalActualQty' }, { header: 'SL lệch', key: 'totalDiffQty' }, { header: 'Giá trị lệch', key: 'totalDiffValue', money: true }, { header: 'Ghi chú', key: 'note', width: 40 },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt) })));
  });
  app.get('/api/stock-takes/:id', { preHandler: requirePermission('stockTakes.view') }, async req => detail(idOf(req)));
  app.post('/api/stock-takes', { preHandler: requirePermission('stockTakes.create') }, async req => {
    const b = input.parse(req.body);
    const id = await db.$transaction(async tx => {
      const d = await saveStockTake(tx, ctxOf(req), b);
      if (b.balance) await balanceStockTake(tx, ctxOf(req), d.id, { zeroMissing: b.zeroMissing });
      return d.id;
    });
    return detail(id);
  });
  app.put('/api/stock-takes/:id', { preHandler: requirePermission('stockTakes.edit') }, async req => {
    const b = input.parse(req.body);
    await db.$transaction(async tx => {
      await saveStockTake(tx, ctxOf(req), b, idOf(req));
      if (b.balance) await balanceStockTake(tx, ctxOf(req), idOf(req), { zeroMissing: b.zeroMissing });
    });
    return detail(idOf(req));
  });
  app.post('/api/stock-takes/:id/balance', { preHandler: requirePermission('stockTakes.edit', 'stockTakes.create') }, async req => {
    const { zeroMissing } = z.object({ zeroMissing: z.boolean().default(false) }).parse(req.body ?? {});
    await db.$transaction(tx => balanceStockTake(tx, ctxOf(req), idOf(req), { zeroMissing }));
    return detail(idOf(req));
  });
  app.post('/api/stock-takes/:id/cancel', { preHandler: requirePermission('stockTakes.delete') }, async req => {
    await db.$transaction(tx => cancelStockTake(tx, ctxOf(req), idOf(req)));
    return detail(idOf(req));
  });
}

export async function stockIssueRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const kind = z.enum(['writeOff', 'internalUse']);
  const input = z.object({ kind, code, reason: z.string().max(500).optional(), note: z.string().max(1000).optional(), lines: z.array(issueLine).min(1, 'Chưa có hàng hóa'), complete: z.boolean().default(false) });
  const perm = (k: string, action: string) => `${k === 'writeOff' ? 'writeOffs' : 'internalUse'}.${action}`;

  async function detail(id: number) {
    const d = await db.stockIssue.findUnique({ where: { id }, include: { lines: true } });
    if (!d) throw notFound('Phiếu');
    const n = await names(app);
    return { ...d, branchName: n.branch(d.branchId), createdByName: n.user(d.createdById), lines: await withProductInfo(db, d.lines) };
  }
  async function guard(req: FastifyRequest, k: string, action: string) {
    if (!hasPerm(req.user, perm(k, action))) throw Object.assign(new Error('Bạn không có quyền thực hiện thao tác này'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  const kindOf = async (id: number) => (await db.stockIssue.findUnique({ where: { id } }))?.kind ?? 'writeOff';
  const where = (req: FastifyRequest): Prisma.StockIssueWhereInput => {
    const q = req.query as Record<string, unknown>;
    return { branchId: user(req).branchId, kind: q.kind === 'internalUse' ? 'internalUse' : 'writeOff', ...commonWhere(q, 'createdAt') };
  };

  app.get('/api/stock-issues', async req => {
    await guard(req, String((req.query as { kind?: string }).kind ?? 'writeOff'), 'view');
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([
      db.stockIssue.findMany({ where: w, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }),
      db.stockIssue.count({ where: w }),
      db.stockIssue.aggregate({ where: w, _sum: { totalQty: true, totalValue: true } }),
    ]);
    const n = await names(app);
    return { items: rows.map(r => ({ ...r, branchName: n.branch(r.branchId), createdByName: n.user(r.createdById) })), total, totals: { totalQty: sums._sum.totalQty ?? 0, totalValue: sums._sum.totalValue ?? 0 } };
  });
  app.get('/api/stock-issues/export', async (req, reply) => {
    const w = where(req);
    await guard(req, String(w.kind), 'view');
    const rows = await db.stockIssue.findMany({ where: w, orderBy: { id: 'desc' } });
    return sendXlsx(reply, `${w.kind === 'writeOff' ? 'xuat-huy' : 'xuat-dung-noi-bo'}.xlsx`, [
      { header: 'Mã phiếu', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Trạng thái', key: 'status' }, { header: 'Lý do', key: 'reason', width: 30 },
      { header: 'Tổng SL', key: 'totalQty' }, { header: 'Tổng giá trị', key: 'totalValue', money: true },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt) })));
  });
  app.get('/api/stock-issues/:id', async req => {
    const d = await detail(idOf(req));
    await guard(req, d.kind, 'view');
    return d;
  });
  app.post('/api/stock-issues', async req => {
    const b = input.parse(req.body);
    await guard(req, b.kind, 'create');
    const id = await db.$transaction(async tx => {
      const d = await saveIssue(tx, ctxOf(req), b);
      if (b.complete) await completeIssue(tx, ctxOf(req), d.id);
      return d.id;
    });
    return detail(id);
  });
  app.put('/api/stock-issues/:id', async req => {
    const b = input.parse(req.body);
    await guard(req, await kindOf(idOf(req)), 'edit');
    await db.$transaction(async tx => {
      await saveIssue(tx, ctxOf(req), b, idOf(req));
      if (b.complete) await completeIssue(tx, ctxOf(req), idOf(req));
    });
    return detail(idOf(req));
  });
  app.post('/api/stock-issues/:id/complete', async req => {
    await guard(req, await kindOf(idOf(req)), 'edit');
    await db.$transaction(tx => completeIssue(tx, ctxOf(req), idOf(req)));
    return detail(idOf(req));
  });
  app.post('/api/stock-issues/:id/cancel', async req => {
    await guard(req, await kindOf(idOf(req)), 'delete');
    await db.$transaction(tx => cancelIssue(tx, ctxOf(req), idOf(req)));
    return detail(idOf(req));
  });
}

export async function transferRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const input = z.object({ code, toBranchId: z.number().int(), note: z.string().max(1000).optional(), lines: z.array(sentLine).min(1, 'Chưa có hàng hóa'), send: z.boolean().default(false) });

  async function detail(id: number) {
    const d = await db.transfer.findUnique({ where: { id }, include: { lines: true } });
    if (!d) throw notFound('Phiếu chuyển hàng');
    const n = await names(app);
    return { ...d, fromBranchName: n.branch(d.fromBranchId), toBranchName: n.branch(d.toBranchId), createdByName: n.user(d.createdById), lines: await withProductInfo(db, d.lines) };
  }
  /** Transfers show at both ends: sent from or arriving at the session branch. */
  const where = (req: FastifyRequest): Prisma.TransferWhereInput => {
    const b = user(req).branchId;
    const dir = (req.query as { direction?: string }).direction;
    return { ...(dir === 'out' ? { fromBranchId: b } : dir === 'in' ? { toBranchId: b } : { OR: [{ fromBranchId: b }, { toBranchId: b }] }), ...commonWhere(req.query as Record<string, unknown>, 'createdAt') };
  };

  app.get('/api/transfers', { preHandler: requirePermission('transfers.view') }, async req => {
    const q = parseList(req.query);
    const w = where(req);
    const [rows, total, sums] = await Promise.all([
      db.transfer.findMany({ where: w, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }),
      db.transfer.count({ where: w }),
      db.transfer.aggregate({ where: w, _sum: { totalSentQty: true, totalReceivedQty: true, totalValue: true } }),
    ]);
    const n = await names(app);
    return { items: rows.map(r => ({ ...r, fromBranchName: n.branch(r.fromBranchId), toBranchName: n.branch(r.toBranchId) })), total, totals: { totalSentQty: sums._sum.totalSentQty ?? 0, totalReceivedQty: sums._sum.totalReceivedQty ?? 0, totalValue: sums._sum.totalValue ?? 0 } };
  });
  app.get('/api/transfers/export', { preHandler: requirePermission('transfers.export', 'transfers.view') }, async (req, reply) => {
    const n = await names(app);
    const rows = await db.transfer.findMany({ where: where(req), orderBy: { id: 'desc' } });
    return sendXlsx(reply, 'chuyen-hang.xlsx', [
      { header: 'Mã chuyển hàng', key: 'code' }, { header: 'Từ chi nhánh', key: 'from' }, { header: 'Tới chi nhánh', key: 'to' }, { header: 'Ngày chuyển', key: 'sent' },
      { header: 'Ngày nhận', key: 'received' }, { header: 'Trạng thái', key: 'status' }, { header: 'SL chuyển', key: 'totalSentQty' }, { header: 'SL nhận', key: 'totalReceivedQty' }, { header: 'Giá trị', key: 'totalValue', money: true },
    ], rows.map(r => ({ ...r, from: n.branch(r.fromBranchId), to: n.branch(r.toBranchId), sent: r.sentAt ? formatDateTime(r.sentAt) : '', received: r.receivedAt ? formatDateTime(r.receivedAt) : '' })));
  });
  app.get('/api/transfers/:id', { preHandler: requirePermission('transfers.view') }, async req => detail(idOf(req)));
  app.post('/api/transfers', { preHandler: requirePermission('transfers.create') }, async req => {
    const b = input.parse(req.body);
    const id = await db.$transaction(async tx => {
      const d = await saveTransfer(tx, ctxOf(req), b);
      if (b.send) await sendTransfer(tx, ctxOf(req), d.id);
      return d.id;
    });
    return detail(id);
  });
  app.put('/api/transfers/:id', { preHandler: requirePermission('transfers.edit') }, async req => {
    const b = input.parse(req.body);
    await db.$transaction(async tx => {
      await saveTransfer(tx, ctxOf(req), b, idOf(req));
      if (b.send) await sendTransfer(tx, ctxOf(req), idOf(req));
    });
    return detail(idOf(req));
  });
  app.post('/api/transfers/:id/send', { preHandler: requirePermission('transfers.edit', 'transfers.create') }, async req => {
    await db.$transaction(tx => sendTransfer(tx, ctxOf(req), idOf(req)));
    return detail(idOf(req));
  });
  app.post('/api/transfers/:id/receive', { preHandler: requirePermission('transfers.edit', 'transfers.create') }, async req => {
    const { lines } = z.object({ lines: z.array(receivedLine).default([]) }).parse(req.body ?? {});
    await db.$transaction(tx => receiveTransfer(tx, ctxOf(req), idOf(req), lines));
    return detail(idOf(req));
  });
  app.post('/api/transfers/:id/cancel', { preHandler: requirePermission('transfers.delete') }, async req => {
    await db.$transaction(tx => cancelTransfer(tx, ctxOf(req), idOf(req)));
    return detail(idOf(req));
  });
}
