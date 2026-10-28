import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { customerInputSchema, formatDate, moneySchema, normalizeVi, signedMoneySchema } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, orderByOf, parseList } from '../lib/list';
import { readXlsx, sendXlsx } from '../lib/excel';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { recomputePartnerBalance } from '../services/partnerLedger';
import { recomputePoints } from '../services/loyalty';
import {
  CUSTOMER_IMPORT_COLUMNS, adjustCustomerDebt, adjustCustomerPoints, autoAssignGroup, importCustomers, receiveCustomerPayment, saveCustomer,
} from '../services/customers';
import { cashCtxOf } from './suppliers';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const numParam = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const range = (from: number | undefined, to: number | undefined) =>
  from !== undefined || to !== undefined ? { ...(from !== undefined ? { gte: from } : {}), ...(to !== undefined ? { lte: to } : {}) } : undefined;

export function customerWhere(q: Record<string, unknown>): Prisma.CustomerWhereInput {
  const search = typeof q.search === 'string' && q.search.trim() ? normalizeVi(q.search) : undefined;
  const status = (q.status as string) ?? 'active';
  const from = dateParam(q.createdFrom), to = dateParam(q.createdTo);
  const total = range(numParam(q.totalFrom), numParam(q.totalTo));
  const debt = range(numParam(q.debtFrom), numParam(q.debtTo));
  const points = range(numParam(q.pointsFrom), numParam(q.pointsTo));
  return {
    ...(status === 'all' ? {} : { isActive: status === 'active' }),
    ...(search ? { searchText: { contains: search } } : {}),
    ...(listParam(q.groupIds) ? { groupId: { in: listParam(q.groupIds)!.map(Number) } } : {}),
    ...(numParam(q.birthdayMonth) ? { birthMonth: numParam(q.birthdayMonth) } : {}),
    ...(q.gender ? { gender: String(q.gender) } : {}),
    ...(q.type ? { type: String(q.type) } : {}),
    ...(total ? { totalSpent: total } : {}),
    ...(debt ? { debt } : {}),
    ...(points ? { points } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
}

export async function customerRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const withGroups = async <T extends { groupId: number | null }>(rows: T[]) => {
    const groups = await db.customerGroup.findMany();
    return rows.map(r => ({ ...r, groupName: groups.find(g => g.id === r.groupId)?.name ?? '' }));
  };

  app.get('/api/customers', { preHandler: requirePermission('customers.view') }, async req => {
    const q = parseList(req.query);
    const where = customerWhere(req.query as Record<string, unknown>);
    const [rows, total, sums] = await Promise.all([
      db.customer.findMany({ where, orderBy: orderByOf(q.sort, ['code', 'name', 'debt', 'points', 'totalSpent', 'createdAt', 'lastPurchaseAt'], { createdAt: 'desc' }), skip: q.skip, take: q.take }),
      db.customer.count({ where }),
      db.customer.aggregate({ where, _sum: { debt: true, totalSpent: true, points: true } }),
    ]);
    return { items: await withGroups(rows), total, totals: { debt: sums._sum.debt ?? 0, totalSpent: sums._sum.totalSpent ?? 0, points: sums._sum.points ?? 0 } };
  });

  app.get('/api/customers/lookup', async req => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (!q) return [];
    const rows = await db.customer.findMany({ where: { isActive: true, OR: [{ phone: q }, { code: q.toUpperCase() }, { searchText: { contains: normalizeVi(q) } }] }, take: 10, orderBy: { lastPurchaseAt: 'desc' } });
    const groups = await db.customerGroup.findMany();
    return rows.map(c => {
      const g = groups.find(x => x.id === c.groupId);
      return { id: c.id, code: c.code, name: c.name, phone: c.phone, groupId: c.groupId, groupName: g?.name ?? '', discountPercent: g?.discountPercent ?? 0, debt: c.debt, points: c.points };
    });
  });

  app.get('/api/customers/export', { preHandler: requirePermission('customers.export', 'customers.view') }, async (req, reply) => {
    const rows = await withGroups(await db.customer.findMany({ where: customerWhere(req.query as Record<string, unknown>), orderBy: { createdAt: 'desc' } }));
    return sendXlsx(reply, 'khach-hang.xlsx', [
      ...CUSTOMER_IMPORT_COLUMNS.filter(c => c.key !== 'group'), { header: 'Nhóm khách hàng', key: 'groupName' },
      { header: 'Nợ hiện tại', key: 'debt', money: true }, { header: 'Điểm', key: 'points' }, { header: 'Tổng bán', key: 'totalSpent', money: true },
    ], rows.map(r => ({ ...r, birthday: r.birthday ? formatDate(r.birthday) : '', gender: r.gender === 'male' ? 'Nam' : r.gender === 'female' ? 'Nữ' : '' })));
  });
  app.get('/api/customers/import-template', { preHandler: requirePermission('customers.create') }, async (_req, reply) =>
    sendXlsx(reply, 'mau-khach-hang.xlsx', CUSTOMER_IMPORT_COLUMNS, [{ code: '', name: 'Nguyễn Văn A', phone: '0901234567', email: '', birthday: '15/08/1990', gender: 'Nam', address: '12 Lê Lợi', ward: 'Phường Bến Thành', province: 'TP. Hồ Chí Minh', group: '', taxCode: '', note: '' }]));
  app.post('/api/customers/import', { preHandler: requirePermission('customers.create') }, async req => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Chưa chọn file');
    let rows: Record<string, unknown>[];
    try { rows = await readXlsx(await file.toBuffer()); } catch { throw badRequest('BAD_FILE', 'File không đúng định dạng Excel (.xlsx)'); }
    if (!rows.length) throw badRequest('EMPTY_FILE', 'File không có dữ liệu');
    return db.$transaction(tx => importCustomers(tx, req.auditCtx, rows), { timeout: 60_000 });
  });

  app.get('/api/customers/:id', { preHandler: requirePermission('customers.view') }, async req => {
    const c = await db.customer.findUnique({ where: { id: idOf(req) } });
    if (!c) throw notFound('Khách hàng');
    return (await withGroups([c]))[0];
  });

  const input = customerInputSchema.extend({ force: z.boolean().default(false) });
  app.post('/api/customers', { preHandler: requirePermission('customers.create') }, async req => {
    const { force, ...b } = input.parse(req.body);
    return db.$transaction(tx => saveCustomer(tx, { ...req.auditCtx, userId: user(req).id }, b, undefined, { force }));
  });
  app.put('/api/customers/:id', { preHandler: requirePermission('customers.edit') }, async req => {
    const { force, ...b } = input.parse(req.body);
    return db.$transaction(tx => saveCustomer(tx, req.auditCtx, b, idOf(req), { force }));
  });
  app.delete('/api/customers/:id', { preHandler: requirePermission('customers.delete') }, async req => {
    const id = idOf(req);
    return db.$transaction(async tx => {
      const c = await tx.customer.findUnique({ where: { id } });
      if (!c) throw notFound('Khách hàng');
      const used = (await tx.partnerLedger.count({ where: { partnerType: 'customer', partnerId: id } })) + (await tx.loyaltyTransaction.count({ where: { customerId: id } }))
        + (await tx.cashVoucher.count({ where: { counterpartyType: 'customer', counterpartyId: id } })) + c.totalSpent;
      if (used) {
        await tx.customer.update({ where: { id }, data: { isActive: false } });
        await audit(tx, req.auditCtx, { action: 'update', entity: 'Customer', entityId: id, entityCode: c.code, summary: `Ngừng hoạt động ${c.code} (đã có giao dịch)` });
        return { deactivated: true };
      }
      await tx.customer.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Customer', entityId: id, entityCode: c.code, summary: `Xóa khách hàng ${c.code} - ${c.name}`, before: c });
      return { deleted: true };
    });
  });

  app.get('/api/customers/:id/ledger', { preHandler: requirePermission('customers.view') }, async req => {
    const q = parseList(req.query);
    const where = { partnerType: 'customer', partnerId: idOf(req) };
    const [items, total] = await Promise.all([db.partnerLedger.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.partnerLedger.count({ where })]);
    return { items, total };
  });
  app.get('/api/customers/:id/points', { preHandler: requirePermission('customers.view') }, async req => {
    const q = parseList(req.query);
    const where = { customerId: idOf(req) };
    const [items, total] = await Promise.all([db.loyaltyTransaction.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.loyaltyTransaction.count({ where })]);
    return { items, total };
  });

  const pay = z.object({ amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'), fundId: z.number().int().nullable().optional(), note: z.string().max(500).default('') });
  app.post('/api/customers/:id/payments', { preHandler: requirePermission('customers.edit', 'cashbook.create') }, async req =>
    db.$transaction(tx => receiveCustomerPayment(tx, cashCtxOf(req), idOf(req), pay.parse(req.body))));
  app.post('/api/customers/:id/adjust-debt', { preHandler: requirePermission('customers.edit') }, async req => {
    const { newDebt, note } = z.object({ newDebt: signedMoneySchema, note: z.string().max(500).default('') }).parse(req.body);
    await db.$transaction(tx => adjustCustomerDebt(tx, req.auditCtx, idOf(req), newDebt, note));
    return { ok: true };
  });
  app.post('/api/customers/:id/adjust-points', { preHandler: requirePermission('customers.edit') }, async req => {
    const { newPoints, note } = z.object({ newPoints: z.number().int().min(0).max(100_000_000), note: z.string().max(500).default('') }).parse(req.body);
    await db.$transaction(tx => adjustCustomerPoints(tx, req.auditCtx, idOf(req), newPoints, note));
    return { ok: true };
  });
  app.get('/api/customers/:id/recompute', async req => {
    if (!user(req).isAdmin) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên');
    const c = await db.customer.findUnique({ where: { id: idOf(req) } });
    if (!c) throw notFound('Khách hàng');
    return { debt: c.debt, computedDebt: await recomputePartnerBalance(db, 'customer', c.id), points: c.points, computedPoints: await recomputePoints(db, c.id) };
  });

  // ── groups
  const groupInput = z.object({ name: z.string().trim().min(1).max(120), discountPercent: z.number().int().min(0).max(100).default(0), minTotalSpent: moneySchema.nullable().default(null), note: z.string().max(500).default('') });
  app.get('/api/customer-groups', async () => {
    const [groups, counts] = await Promise.all([db.customerGroup.findMany({ orderBy: { name: 'asc' } }), db.customer.groupBy({ by: ['groupId'], _count: { _all: true }, where: { isActive: true } })]);
    return groups.map(g => ({ ...g, customerCount: counts.find(c => c.groupId === g.id)?._count._all ?? 0 }));
  });
  app.post('/api/customer-groups', { preHandler: requirePermission('customers.create', 'customers.edit') }, async req => {
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      const g = await tx.customerGroup.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'CustomerGroup', entityId: g.id, entityCode: g.name, summary: `Tạo nhóm khách hàng ${g.name}`, after: g });
      return g;
    });
  });
  app.put('/api/customer-groups/:id', { preHandler: requirePermission('customers.edit') }, async req => {
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.customerGroup.findUnique({ where: { id: idOf(req) } });
      if (!before) throw notFound('Nhóm khách hàng');
      const g = await tx.customerGroup.update({ where: { id: before.id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'CustomerGroup', entityId: g.id, entityCode: g.name, summary: `Sửa nhóm khách hàng ${g.name}`, before, after: g });
      return g;
    });
  });
  app.delete('/api/customer-groups/:id', { preHandler: requirePermission('customers.delete') }, async req => {
    const id = idOf(req);
    return db.$transaction(async tx => {
      const g = await tx.customerGroup.findUnique({ where: { id } });
      if (!g) throw notFound('Nhóm khách hàng');
      const books = await tx.priceBook.findMany({ select: { customerGroupIds: true } });
      if ((await tx.customer.count({ where: { groupId: id } })) || books.some(b => (JSON.parse(b.customerGroupIds) as number[]).includes(id))) throw conflict('IN_USE', 'Nhóm đang có khách hàng hoặc được dùng trong bảng giá');
      await tx.customerGroup.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'CustomerGroup', entityId: id, entityCode: g.name, summary: `Xóa nhóm khách hàng ${g.name}`, before: g });
      return { ok: true };
    });
  });
  app.post('/api/customer-groups/apply-auto', { preHandler: requirePermission('customers.edit') }, async req =>
    db.$transaction(async tx => {
      const customers = await tx.customer.findMany({ where: { isActive: true }, select: { id: true } });
      for (const c of customers) await autoAssignGroup(tx, c.id);
      await audit(tx, req.auditCtx, { action: 'update', entity: 'CustomerGroup', entityId: 'auto', summary: `Phân nhóm tự động ${customers.length} khách hàng` });
      return { ok: true, processed: customers.length };
    }, { timeout: 120_000 }));
}
