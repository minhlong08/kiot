import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { moneySchema, normalizeVi, signedMoneySchema, supplierInputSchema } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, orderByOf, parseList } from '../lib/list';
import { readXlsx, sendXlsx } from '../lib/excel';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { recomputePartnerBalance } from '../services/partnerLedger';
import { SUPPLIER_IMPORT_COLUMNS, adjustSupplierDebt, importSuppliers, paySupplier, purchaseTotals, saveSupplier } from '../services/suppliers';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
export const cashCtxOf = (req: FastifyRequest) => { const u = user(req); return { ...req.auditCtx, userId: u.id, branchId: u.branchId }; };

export async function supplierRoutes(app: FastifyInstance) {
  const db = app.prisma;

  // ── groups
  const groupInput = z.object({ name: z.string().trim().min(1).max(120), note: z.string().max(500).default('') });
  app.get('/api/supplier-groups', async () => {
    const [groups, counts] = await Promise.all([db.supplierGroup.findMany({ orderBy: { name: 'asc' } }), db.supplier.groupBy({ by: ['groupId'], _count: { _all: true } })]);
    return groups.map(g => ({ ...g, supplierCount: counts.find(c => c.groupId === g.id)?._count._all ?? 0 }));
  });
  app.post('/api/supplier-groups', { preHandler: requirePermission('suppliers.create', 'suppliers.edit') }, async req => {
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      const g = await tx.supplierGroup.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'SupplierGroup', entityId: g.id, entityCode: g.name, summary: `Tạo nhóm NCC ${g.name}` });
      return g;
    });
  });
  app.put('/api/supplier-groups/:id', { preHandler: requirePermission('suppliers.edit') }, async req => {
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      const g = await tx.supplierGroup.update({ where: { id: idOf(req) }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'SupplierGroup', entityId: g.id, entityCode: g.name, summary: `Sửa nhóm NCC ${g.name}` });
      return g;
    });
  });
  app.delete('/api/supplier-groups/:id', { preHandler: requirePermission('suppliers.delete') }, async req => {
    const id = idOf(req);
    return db.$transaction(async tx => {
      if (await tx.supplier.count({ where: { groupId: id } })) throw conflict('IN_USE', 'Nhóm đang có nhà cung cấp');
      const g = await tx.supplierGroup.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'SupplierGroup', entityId: id, entityCode: g.name, summary: `Xóa nhóm NCC ${g.name}` });
      return { ok: true };
    });
  });

  // ── list
  async function filtered(q: Record<string, unknown>) {
    const search = typeof q.search === 'string' && q.search.trim() ? normalizeVi(q.search) : undefined;
    const groupIds = listParam(q.groupIds)?.map(Number);
    const status = (q.status as string) ?? 'active';
    const debtFrom = q.debtFrom !== undefined && q.debtFrom !== '' ? Number(q.debtFrom) : undefined;
    const debtTo = q.debtTo !== undefined && q.debtTo !== '' ? Number(q.debtTo) : undefined;
    const where: Prisma.SupplierWhereInput = {
      ...(status === 'all' ? {} : { isActive: status === 'active' }),
      ...(search ? { searchText: { contains: search } } : {}),
      ...(groupIds ? { groupId: { in: groupIds } } : {}),
      ...(debtFrom !== undefined || debtTo !== undefined ? { debt: { ...(debtFrom !== undefined ? { gte: debtFrom } : {}), ...(debtTo !== undefined ? { lte: debtTo } : {}) } } : {}),
    };
    let rows = await db.supplier.findMany({ where, orderBy: orderByOf(q.sort as string | undefined, ['code', 'name', 'debt', 'createdAt'], { createdAt: 'desc' }) });
    // Net purchases per supplier; the amount filter runs on this derived figure (supplier tables are small).
    const totals = await purchaseTotals(db, dateParam(q.totalDateFrom), dateParam(q.totalDateTo));
    const totalFrom = q.totalFrom !== undefined && q.totalFrom !== '' ? Number(q.totalFrom) : undefined;
    const totalTo = q.totalTo !== undefined && q.totalTo !== '' ? Number(q.totalTo) : undefined;
    if (totalFrom !== undefined) rows = rows.filter(r => (totals.get(r.id) ?? 0) >= totalFrom);
    if (totalTo !== undefined) rows = rows.filter(r => (totals.get(r.id) ?? 0) <= totalTo);
    const groups = await db.supplierGroup.findMany();
    return rows.map(r => ({ ...r, groupName: groups.find(g => g.id === r.groupId)?.name ?? '', totalPurchased: totals.get(r.id) ?? 0 }));
  }

  app.get('/api/suppliers', { preHandler: requirePermission('suppliers.view', 'purchaseReceipts.create', 'purchaseOrders.create') }, async req => {
    const q = parseList(req.query);
    const rows = await filtered(req.query as Record<string, unknown>);
    return {
      items: rows.slice(q.skip, q.skip + q.take), total: rows.length,
      totals: { debt: rows.reduce((s, r) => s + r.debt, 0), totalPurchased: rows.reduce((s, r) => s + r.totalPurchased, 0) },
    };
  });

  app.get('/api/suppliers/export', { preHandler: requirePermission('suppliers.export', 'suppliers.view') }, async (req, reply) =>
    sendXlsx(reply, 'nha-cung-cap.xlsx', [
      ...SUPPLIER_IMPORT_COLUMNS.filter(c => c.key !== 'group'), { header: 'Nhóm nhà cung cấp', key: 'groupName' },
      { header: 'Nợ cần trả hiện tại', key: 'debt', money: true }, { header: 'Tổng mua', key: 'totalPurchased', money: true },
    ], await filtered(req.query as Record<string, unknown>)));

  app.get('/api/suppliers/import-template', { preHandler: requirePermission('suppliers.create') }, async (_req, reply) =>
    sendXlsx(reply, 'mau-nha-cung-cap.xlsx', SUPPLIER_IMPORT_COLUMNS, [{ code: 'NCC000001', name: 'Công ty TNHH May Mẫu', phone: '0281234567', email: '', taxCode: '0312345678', address: 'TP. Hồ Chí Minh', company: '', group: 'May mặc', note: '' }]));

  app.post('/api/suppliers/import', { preHandler: requirePermission('suppliers.create') }, async req => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Chưa chọn file');
    let rows: Record<string, unknown>[];
    try { rows = await readXlsx(await file.toBuffer()); } catch { throw badRequest('BAD_FILE', 'File không đúng định dạng Excel (.xlsx)'); }
    if (!rows.length) throw badRequest('EMPTY_FILE', 'File không có dữ liệu');
    return db.$transaction(tx => importSuppliers(tx, req.auditCtx, rows), { timeout: 60_000 });
  });

  // ── single
  app.get('/api/suppliers/:id', { preHandler: requirePermission('suppliers.view', 'purchaseReceipts.create') }, async req => {
    const s = await db.supplier.findUnique({ where: { id: idOf(req) } });
    if (!s) throw notFound('Nhà cung cấp');
    const totals = await purchaseTotals(db, undefined, undefined, [s.id]);
    const group = s.groupId ? await db.supplierGroup.findUnique({ where: { id: s.groupId } }) : null;
    return { ...s, groupName: group?.name ?? '', totalPurchased: totals.get(s.id) ?? 0 };
  });

  app.post('/api/suppliers', { preHandler: requirePermission('suppliers.create', 'purchaseReceipts.create') }, async req =>
    db.$transaction(tx => saveSupplier(tx, req.auditCtx, supplierInputSchema.parse(req.body))));

  app.put('/api/suppliers/:id', { preHandler: requirePermission('suppliers.edit') }, async req =>
    db.$transaction(tx => saveSupplier(tx, req.auditCtx, supplierInputSchema.parse(req.body), idOf(req))));

  app.delete('/api/suppliers/:id', { preHandler: requirePermission('suppliers.delete') }, async req => {
    const id = idOf(req);
    return db.$transaction(async tx => {
      const s = await tx.supplier.findUnique({ where: { id } });
      if (!s) throw notFound('Nhà cung cấp');
      const used = (await tx.partnerLedger.count({ where: { partnerType: 'supplier', partnerId: id } }))
        + (await tx.purchaseReceipt.count({ where: { supplierId: id } })) + (await tx.purchaseOrder.count({ where: { supplierId: id } }))
        + (await tx.purchaseReturn.count({ where: { supplierId: id } })) + (await tx.servicePurchase.count({ where: { supplierId: id } }));
      if (used) {
        await tx.supplier.update({ where: { id }, data: { isActive: false } });
        await audit(tx, req.auditCtx, { action: 'update', entity: 'Supplier', entityId: id, entityCode: s.code, summary: `Ngừng hoạt động ${s.code} (đã có giao dịch)` });
        return { deactivated: true };
      }
      await tx.supplier.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Supplier', entityId: id, entityCode: s.code, summary: `Xóa nhà cung cấp ${s.code} - ${s.name}`, before: s });
      return { deleted: true };
    });
  });

  app.get('/api/suppliers/:id/history', { preHandler: requirePermission('suppliers.view') }, async req => {
    const id = idOf(req);
    const [receipts, returns] = await Promise.all([
      db.purchaseReceipt.findMany({ where: { supplierId: id }, orderBy: { id: 'desc' }, take: 200 }),
      db.purchaseReturn.findMany({ where: { supplierId: id }, orderBy: { id: 'desc' }, take: 200 }),
    ]);
    return [
      ...receipts.map(r => ({ type: 'receipt', id: r.id, code: r.code, createdAt: r.createdAt, total: r.total, status: r.status })),
      ...returns.map(r => ({ type: 'purchaseReturn', id: r.id, code: r.code, createdAt: r.createdAt, total: r.total, status: r.status })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });

  app.get('/api/suppliers/:id/ledger', { preHandler: requirePermission('suppliers.view') }, async req => {
    const q = parseList(req.query);
    const where = { partnerType: 'supplier', partnerId: idOf(req) };
    const [items, total] = await Promise.all([db.partnerLedger.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.partnerLedger.count({ where })]);
    return { items, total };
  });

  const payInput = z.object({ amount: moneySchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'), fundId: z.number().int().nullable().optional(), note: z.string().max(500).default(''), at: z.string().datetime({ offset: true }).optional() });
  app.post('/api/suppliers/:id/payments', { preHandler: requirePermission('suppliers.edit', 'cashbook.create') }, async req => {
    const p = payInput.parse(req.body);
    return db.$transaction(tx => paySupplier(tx, cashCtxOf(req), idOf(req), { ...p, at: p.at ? new Date(p.at) : undefined }));
  });

  app.post('/api/suppliers/:id/adjust-debt', { preHandler: requirePermission('suppliers.edit') }, async req => {
    const { newDebt, note } = z.object({ newDebt: signedMoneySchema, note: z.string().trim().min(1, 'Nhập lý do điều chỉnh').max(500) }).parse(req.body);
    await db.$transaction(tx => adjustSupplierDebt(tx, req.auditCtx, idOf(req), newDebt, note));
    return { ok: true };
  });

  app.get('/api/suppliers/:id/recompute', async req => {
    if (!user(req).isAdmin) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên');
    const s = await db.supplier.findUnique({ where: { id: idOf(req) } });
    if (!s) throw notFound('Nhà cung cấp');
    return { cached: s.debt, computed: await recomputePartnerBalance(db, 'supplier', s.id) };
  });

}
