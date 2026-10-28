import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { amountInWords, formatDateTime, moneySchema } from '@pd/shared';
import type { Prisma, Tx } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { recordCash } from '../services/cash';
import { postPartnerLedger, reversePartnerDocument } from '../services/partnerLedger';
import { nextCode } from '../services/codes';
import { idOf } from './purchasing';
import { cashCtxOf } from './suppliers';

const MANUAL_SOURCES = ['manual', 'transfer'];
const COUNTERPARTY = ['customer', 'supplier', 'employee', 'other'] as const;

async function ensureTransferCategories(tx: Tx) {
  for (const kind of ['in', 'out']) await tx.cashCategory.upsert({ where: { kind_name: { kind, name: 'Chuyển quỹ' } }, create: { kind, name: 'Chuyển quỹ', isSystem: true, affectsPnl: false }, update: {} });
}

/** Funds visible from a branch: company-wide ones and the branch's own. */
const fundScope = (branchId: number) => ({ OR: [{ branchId: null }, { branchId }] });

async function balances(tx: Tx, fundIds: number[], branchId: number | null) {
  const branch = branchId === null ? {} : { branchId };
  const rows = await tx.cashVoucher.groupBy({ by: ['fundId', 'kind'], _sum: { amount: true }, where: { fundId: { in: fundIds }, status: 'completed', ...branch } });
  const funds = await tx.cashFund.findMany({ where: { id: { in: fundIds } } });
  return new Map(funds.map(f => [f.id, f.openingBalance + rows.filter(r => r.fundId === f.id).reduce((s, r) => s + (r.kind === 'in' ? 1 : -1) * (r._sum.amount ?? 0), 0)]));
}

export async function cashbookRoutes(app: FastifyInstance) {
  const db = app.prisma;

  // ── funds
  const fundInput = z.object({
    type: z.enum(['cash', 'bank', 'ewallet']), name: z.string().trim().min(1).max(120), bankName: z.string().max(120).default(''), bankBin: z.string().regex(/^\d{0,8}$/, 'Mã BIN gồm chữ số').default(''),
    accountNumber: z.string().max(40).default(''), accountName: z.string().max(120).default(''), branchId: z.number().int().nullable().default(null),
    openingBalance: z.number().int().min(-2_000_000_000).max(2_000_000_000).default(0), isActive: z.boolean().default(true),
  });
  app.get('/api/cash-funds', async req => {
    const u = user(req);
    const all = (req.query as { all?: string }).all === '1';
    const funds = await db.cashFund.findMany({ where: { ...(all ? {} : { isActive: true }), ...fundScope(u.branchId) }, orderBy: [{ type: 'asc' }, { id: 'asc' }] });
    if (!hasPerm(u, 'cashbook.view')) return funds.map(({ openingBalance: _o, ...f }) => f);
    const b = await balances(db, funds.map(f => f.id), u.isAdmin ? null : u.branchId);
    return funds.map(f => ({ ...f, balance: b.get(f.id) ?? f.openingBalance }));
  });
  app.post('/api/cash-funds', { preHandler: requirePermission('cashbook.edit', 'settings.edit') }, async req => {
    const data = fundInput.parse(req.body);
    return db.$transaction(async tx => {
      const f = await tx.cashFund.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'CashFund', entityId: f.id, entityCode: f.name, summary: `Tạo quỹ ${f.name}`, after: f });
      return f;
    });
  });
  /** POS sales and refunds post to these funds; switching them off would make every such payment fail. */
  async function assertFundRemovable(tx: Tx, f: { id: number; type: string }) {
    const pos = (await getSettings(tx)).pos.defaultFundIds;
    if (Object.values(pos).includes(f.id)) throw conflict('FUND_IN_USE', 'Quỹ đang là quỹ mặc định khi bán hàng (Thiết lập › Bán hàng)');
    if (f.type === 'cash' && (await tx.cashFund.count({ where: { type: 'cash', isActive: true, id: { not: f.id } } })) === 0) throw conflict('FUND_IN_USE', 'Cần ít nhất một quỹ tiền mặt đang hoạt động');
  }
  app.put('/api/cash-funds/:id', { preHandler: requirePermission('cashbook.edit', 'settings.edit') }, async req => {
    // Partial: fields the client did not send (e.g. openingBalance hidden from users without cashbook.view) stay as they are.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = fundInput.partial().parse(body);
    const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in body)) as typeof parsed;
    if (!hasPerm(user(req), 'cashbook.view')) delete data.openingBalance;
    return db.$transaction(async tx => {
      const before = await tx.cashFund.findUnique({ where: { id: idOf(req) } });
      if (!before) throw notFound('Quỹ tiền');
      if (before.isActive && data.isActive === false) await assertFundRemovable(tx, { id: before.id, type: data.type ?? before.type });
      const f = await tx.cashFund.update({ where: { id: before.id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'CashFund', entityId: f.id, entityCode: f.name, summary: `Sửa quỹ ${f.name}`, before, after: f });
      return f;
    });
  });
  app.delete('/api/cash-funds/:id', { preHandler: requirePermission('cashbook.delete', 'settings.edit') }, async req =>
    db.$transaction(async tx => {
      const f = await tx.cashFund.findUnique({ where: { id: idOf(req) } });
      if (!f) throw notFound('Quỹ tiền');
      if (f.isActive) await assertFundRemovable(tx, f);
      if (await tx.cashVoucher.count({ where: { fundId: f.id } })) {
        await tx.cashFund.update({ where: { id: f.id }, data: { isActive: false } });
        await audit(tx, req.auditCtx, { action: 'update', entity: 'CashFund', entityId: f.id, entityCode: f.name, summary: `Ngừng sử dụng quỹ ${f.name}` });
        return { deactivated: true };
      }
      await tx.cashFund.delete({ where: { id: f.id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'CashFund', entityId: f.id, entityCode: f.name, summary: `Xóa quỹ ${f.name}`, before: f });
      return { deleted: true };
    }));

  // ── categories
  const catInput = z.object({ kind: z.enum(['in', 'out']), name: z.string().trim().min(1).max(120), affectsPnl: z.boolean().default(true) });
  app.get('/api/cash-categories', async () => db.cashCategory.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
  app.post('/api/cash-categories', { preHandler: requirePermission('cashbook.create', 'cashbook.edit') }, async req => {
    const data = catInput.parse(req.body);
    return db.$transaction(async tx => {
      const c = await tx.cashCategory.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'CashCategory', entityId: c.id, entityCode: c.name, summary: `Tạo loại thu chi ${c.name}` });
      return c;
    });
  });
  async function userCategory(tx: Tx, id: number) {
    const c = await tx.cashCategory.findUnique({ where: { id } });
    if (!c) throw notFound('Loại thu chi');
    if (c.isSystem) throw conflict('SYSTEM_CATEGORY', 'Không thể sửa hoặc xóa loại thu chi hệ thống');
    return c;
  }
  app.put('/api/cash-categories/:id', { preHandler: requirePermission('cashbook.edit') }, async req => {
    const data = catInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await userCategory(tx, idOf(req));
      const c = await tx.cashCategory.update({ where: { id: before.id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'CashCategory', entityId: c.id, entityCode: c.name, summary: `Sửa loại thu chi ${c.name}`, before, after: c });
      return c;
    });
  });
  app.delete('/api/cash-categories/:id', { preHandler: requirePermission('cashbook.delete') }, async req =>
    db.$transaction(async tx => {
      const c = await userCategory(tx, idOf(req));
      if (await tx.cashVoucher.count({ where: { categoryId: c.id } })) throw conflict('IN_USE', 'Loại thu chi đã được sử dụng');
      await tx.cashCategory.delete({ where: { id: c.id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'CashCategory', entityId: c.id, entityCode: c.name, summary: `Xóa loại thu chi ${c.name}` });
      return { ok: true };
    }));

  // ── vouchers
  async function scope(req: FastifyRequest) {
    const u = user(req);
    const q = req.query as Record<string, unknown>;
    const allBranches = u.isAdmin && q.branchId === 'all';
    const fundType = q.fundType as string | undefined;
    const explicit = listParam(q.fundIds)?.map(Number);
    const funds = await db.cashFund.findMany({ where: { ...(allBranches ? {} : fundScope(u.branchId)), ...(fundType && fundType !== 'all' ? { type: fundType } : {}), ...(explicit ? { id: { in: explicit } } : {}) } });
    return { fundIds: funds.map(f => f.id), funds, branch: allBranches ? {} : { branchId: u.branchId } };
  }
  function filters(req: FastifyRequest): Prisma.CashVoucherWhereInput {
    const q = req.query as Record<string, unknown>;
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    return {
      ...(q.kind === 'in' || q.kind === 'out' ? { kind: q.kind } : {}),
      ...(listParam(q.categoryIds) ? { categoryId: { in: listParam(q.categoryIds)!.map(Number) } } : {}),
      ...(listParam(q.createdBy) ? { createdById: { in: listParam(q.createdBy)!.map(Number) } } : {}),
      ...(listParam(q.counterpartyType) ? { counterpartyType: { in: listParam(q.counterpartyType)! } } : {}),
      ...(q.affectsPnl === 'true' ? { affectsPnl: true } : q.affectsPnl === 'false' ? { affectsPnl: false } : {}),
      ...(search ? { OR: [{ code: { contains: search.toUpperCase() } }, { counterpartyName: { contains: search } }, { sourceCode: { contains: search.toUpperCase() } }] } : {}),
    };
  }
  async function decorate<T extends { categoryId: number; fundId: number; createdById: number }>(rows: T[]) {
    const [cats, funds, users] = await Promise.all([db.cashCategory.findMany(), db.cashFund.findMany(), db.user.findMany({ select: { id: true, fullName: true } })]);
    return rows.map(r => ({ ...r, categoryName: cats.find(c => c.id === r.categoryId)?.name ?? '', fundName: funds.find(f => f.id === r.fundId)?.name ?? '', createdByName: users.find(u => u.id === r.createdById)?.fullName ?? '' }));
  }

  app.get('/api/cash-vouchers', { preHandler: requirePermission('cashbook.view') }, async req => {
    const q = parseList(req.query);
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const s = await scope(req);
    const statuses = listParam(raw.status) ?? ['completed'];
    const base: Prisma.CashVoucherWhereInput = { fundId: { in: s.fundIds }, ...s.branch, ...filters(req) };
    const period = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
    const where: Prisma.CashVoucherWhereInput = { ...base, status: { in: statuses }, ...(from || to ? { createdAt: period } : {}) };
    const sum = async (w: Prisma.CashVoucherWhereInput, kind: 'in' | 'out') => (await db.cashVoucher.aggregate({ _sum: { amount: true }, where: { ...w, kind, status: 'completed' } }))._sum.amount ?? 0;
    // Summary ignores the list's text/category filters: it is the fund balance over the period.
    const fundBase = { fundId: { in: s.fundIds }, ...s.branch };
    const openingBalance = s.funds.reduce((t, f) => t + f.openingBalance, 0);
    const before = from ? (await sum({ ...fundBase, createdAt: { lt: from } }, 'in')) - (await sum({ ...fundBase, createdAt: { lt: from } }, 'out')) : 0;
    const inn = await sum({ ...fundBase, ...(from || to ? { createdAt: period } : {}) }, 'in');
    const out = await sum({ ...fundBase, ...(from || to ? { createdAt: period } : {}) }, 'out');
    const opening = openingBalance + before;
    const [rows, total] = await Promise.all([db.cashVoucher.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }), db.cashVoucher.count({ where })]);
    return { items: await decorate(rows), total, summary: { opening, in: inn, out, closing: opening + inn - out } };
  });

  app.get('/api/cash-vouchers/export', { preHandler: requirePermission('cashbook.export') }, async (req, reply) => {
    if (!hasPerm(user(req), 'cashbook.view')) throw new AppError(403, 'FORBIDDEN', 'Không có quyền xem sổ quỹ');
    const raw = req.query as Record<string, unknown>;
    const from = dateParam(raw.from), to = dateParam(raw.to);
    const s = await scope(req);
    const rows = await decorate(await db.cashVoucher.findMany({ where: { fundId: { in: s.fundIds }, ...s.branch, ...filters(req), status: { in: listParam(raw.status) ?? ['completed'] }, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) }, orderBy: { createdAt: 'asc' } }));
    return sendXlsx(reply, 'so-quy.xlsx', [
      { header: 'Mã phiếu', key: 'code' }, { header: 'Thời gian', key: 'time' }, { header: 'Quỹ', key: 'fundName' }, { header: 'Loại thu chi', key: 'categoryName', width: 24 },
      { header: 'Người nộp/nhận', key: 'counterpartyName', width: 26 }, { header: 'Thu', key: 'in', money: true }, { header: 'Chi', key: 'out', money: true },
      { header: 'Chứng từ gốc', key: 'sourceCode' }, { header: 'Hạch toán KQKD', key: 'pnl' }, { header: 'Ghi chú', key: 'note', width: 30 },
    ], rows.map(r => ({ ...r, time: formatDateTime(r.createdAt), in: r.kind === 'in' ? r.amount : null, out: r.kind === 'out' ? r.amount : null, pnl: r.affectsPnl ? 'Có' : 'Không' })));
  });

  async function owned(req: FastifyRequest, id: number) {
    const v = await db.cashVoucher.findUnique({ where: { id } });
    const u = user(req);
    if (!v || (v.branchId !== u.branchId && !u.isAdmin)) throw notFound('Phiếu thu chi');
    return v;
  }
  app.get('/api/cash-vouchers/:id', { preHandler: requirePermission('cashbook.view') }, async req => (await decorate([await owned(req, idOf(req))]))[0]);
  app.get('/api/cash-vouchers/:id/print', { preHandler: requirePermission('cashbook.view') }, async req => {
    const [v] = await decorate([await owned(req, idOf(req))]);
    return { ...v, amountInWords: amountInWords(v.amount), store: (await getSettings(db)).store };
  });

  const voucherInput = z.object({
    kind: z.enum(['in', 'out']), fundId: z.number().int(), amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'), categoryId: z.number().int(),
    counterpartyType: z.enum(COUNTERPARTY), counterpartyId: z.number().int().nullable().default(null), counterpartyName: z.string().trim().max(200).default(''),
    note: z.string().max(1000).default(''), at: z.string().datetime({ offset: true }).optional(), postToDebt: z.boolean().default(false),
  });
  app.post('/api/cash-vouchers', { preHandler: requirePermission('cashbook.create') }, async req => {
    const b = voucherInput.parse(req.body);
    const ctx = cashCtxOf(req);
    return db.$transaction(async tx => {
      const cat = await tx.cashCategory.findUnique({ where: { id: b.categoryId } });
      if (!cat || cat.kind !== b.kind) throw badRequest('INVALID_CATEGORY', 'Loại thu chi không phù hợp');
      let name = b.counterpartyName;
      if (b.counterpartyType === 'customer' || b.counterpartyType === 'supplier') {
        const p = b.counterpartyId ? (b.counterpartyType === 'customer' ? await tx.customer.findUnique({ where: { id: b.counterpartyId } }) : await tx.supplier.findUnique({ where: { id: b.counterpartyId } })) : null;
        if (!p) throw notFound(b.counterpartyType === 'customer' ? 'Khách hàng' : 'Nhà cung cấp');
        name = p.name;
      } else if (b.postToDebt) throw badRequest('DEBT_NEEDS_PARTNER', 'Chỉ khách hàng hoặc nhà cung cấp mới có công nợ');
      const prefixes = (await getSettings(tx)).orders.codePrefixes;
      const v = (await recordCash(tx, ctx, { kind: b.kind, amount: b.amount, fundId: b.fundId, categoryId: cat.id, counterpartyType: b.counterpartyType, counterpartyId: b.counterpartyId, counterpartyName: name, sourceType: 'manual', codePrefix: b.kind === 'in' ? prefixes.cashIn : prefixes.cashOut, note: b.note, at: b.at ? new Date(b.at) : undefined }))!;
      await tx.cashVoucher.update({ where: { id: v.id }, data: { sourceId: v.id, sourceCode: v.code } });
      if (b.postToDebt) {
        // Money in from a customer / out to a supplier settles debt; the reverse directions increase it.
        const sign = (b.counterpartyType === 'customer') === (b.kind === 'in') ? -1 : 1;
        await postPartnerLedger(tx, { partnerType: b.counterpartyType as 'customer' | 'supplier', partnerId: b.counterpartyId!, amount: sign * b.amount, docType: 'manualVoucher', docId: v.id, docCode: v.code, note: b.note, at: b.at ? new Date(b.at) : undefined });
      }
      return tx.cashVoucher.findUniqueOrThrow({ where: { id: v.id } });
    });
  });

  app.post('/api/cash-vouchers/transfer', { preHandler: requirePermission('cashbook.create') }, async req => {
    const b = z.object({ fromFundId: z.number().int(), toFundId: z.number().int(), amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'), note: z.string().max(500).default('') }).parse(req.body);
    if (b.fromFundId === b.toFundId) throw badRequest('SAME_FUND', 'Quỹ chuyển và quỹ nhận phải khác nhau');
    const ctx = cashCtxOf(req);
    return db.$transaction(async tx => {
      await ensureTransferCategories(tx);
      const [from, to] = await Promise.all([tx.cashFund.findUnique({ where: { id: b.fromFundId } }), tx.cashFund.findUnique({ where: { id: b.toFundId } })]);
      for (const f of [from, to]) if (!f || !f.isActive || (f.branchId !== null && f.branchId !== ctx.branchId)) throw notFound('Quỹ tiền');
      const ref = await nextCode(tx, 'CQ');
      const prefixes = (await getSettings(tx)).orders.codePrefixes;
      const common = { amount: b.amount, categoryName: 'Chuyển quỹ', counterpartyType: 'other' as const, sourceType: 'transfer', sourceCode: ref, note: b.note || `Chuyển từ ${from!.name} sang ${to!.name}`, affectsPnl: false };
      const out = (await recordCash(tx, ctx, { ...common, kind: 'out', fundId: from!.id, counterpartyName: to!.name, codePrefix: prefixes.cashOut }))!;
      const inn = (await recordCash(tx, ctx, { ...common, kind: 'in', fundId: to!.id, counterpartyName: from!.name, codePrefix: prefixes.cashIn, sourceId: out.id }))!;
      await tx.cashVoucher.update({ where: { id: out.id }, data: { sourceId: out.id } });
      return { out: await tx.cashVoucher.findUniqueOrThrow({ where: { id: out.id } }), in: inn };
    });
  });

  app.post('/api/cash-vouchers/:id/cancel', { preHandler: requirePermission('cashbook.delete') }, async req => {
    const v = await owned(req, idOf(req));
    if (!MANUAL_SOURCES.includes(v.sourceType ?? '')) throw new AppError(409, 'AUTO_VOUCHER', `Phiếu tạo tự động từ ${v.sourceCode ?? 'chứng từ'}: hãy hủy chứng từ gốc`);
    if (v.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
    const ctx = cashCtxOf(req);
    await db.$transaction(async tx => {
      // Claim the voucher first so a concurrent cancel cannot reverse its ledger rows a second time.
      if (!(await tx.cashVoucher.updateMany({ where: { id: v.id, status: 'completed' }, data: { status: 'cancelled' } })).count) throw conflict('ALREADY_CANCELLED', 'Phiếu đã hủy');
      if (v.sourceType === 'transfer') {
        const pair = await tx.cashVoucher.findMany({ where: { sourceType: 'transfer', sourceCode: v.sourceCode, status: 'completed' } });
        await tx.cashVoucher.updateMany({ where: { id: { in: pair.map(p => p.id) } }, data: { status: 'cancelled' } });
        await audit(tx, ctx, { action: 'cancel', entity: 'CashVoucher', entityId: v.id, entityCode: v.code, summary: `Hủy chuyển quỹ ${v.sourceCode}` });
      } else {
        await audit(tx, ctx, { action: 'cancel', entity: 'CashVoucher', entityId: v.id, entityCode: v.code, summary: `Hủy phiếu ${v.code}` });
        await reversePartnerDocument(tx, 'manualVoucher', v.id, 'manualVoucher_cancel');
      }
    });
    return db.cashVoucher.findUniqueOrThrow({ where: { id: v.id } });
  });
}
