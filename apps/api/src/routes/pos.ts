import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { moneySchema } from '@pd/shared';
import type { Tx } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { activePromotions } from '../services/promotions';
import { applicablePriceBooks } from '../services/priceBooks';
import { isVariantMaster } from '../services/products';
import { idOf } from './purchasing';

import { ensureSalesChannels as ensureChannels } from '../services/channels';
import { activeTemplates } from './printTemplates';
export { ensureChannels };

/** Cash drawer movement of one user in cash funds since a moment (for shift close). */
async function drawerSince(tx: Tx, userId: number, branchId: number, since: Date, until?: Date) {
  const funds = (await tx.cashFund.findMany({ where: { type: 'cash' } })).map(f => f.id);
  const where = { createdById: userId, branchId, fundId: { in: funds }, status: 'completed', createdAt: { gte: since, ...(until ? { lte: until } : {}) } };
  const [i, o] = await Promise.all([
    tx.cashVoucher.aggregate({ _sum: { amount: true }, where: { ...where, kind: 'in' } }),
    tx.cashVoucher.aggregate({ _sum: { amount: true }, where: { ...where, kind: 'out' } }),
  ]);
  return (i._sum.amount ?? 0) - (o._sum.amount ?? 0);
}

export async function posRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/pos/bootstrap', { preHandler: requirePermission('pos.access', 'invoices.create') }, async req => {
    const u = user(req);
    await ensureChannels(db);
    const [settings, branch, funds, books, promotions, channels, groups] = await Promise.all([
      getSettings(db), db.branch.findUniqueOrThrow({ where: { id: u.branchId } }), db.cashFund.findMany({ where: { isActive: true, OR: [{ branchId: null }, { branchId: u.branchId }] } }),
      applicablePriceBooks(db, { branchId: u.branchId, userId: u.id, at: new Date() }), activePromotions(db, { branchId: u.branchId, customerGroupId: null }),
      db.salesChannel.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }), db.productGroup.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } });
    return {
      settings, branch: { id: branch.id, name: branch.name, address: branch.address, phone: branch.phone }, funds, channels, groups, users,
      printTemplates: (await activeTemplates(db)).filter(t => t.kind === 'invoice').map(({ size, body }) => ({ size, body })),
      priceBooks: books.map(b => ({ id: b.id, name: b.name, customerGroupIds: JSON.parse(b.customerGroupIds) as number[], allowOutsideItems: b.allowOutsideItems })),
      promotions,
      user: { id: u.id, fullName: u.fullName, isAdmin: u.isAdmin, maxDiscountPercent: u.maxDiscountPercent, canEditPrice: hasPerm(u, 'pos.editPrice'), canSeeCost: hasPerm(u, 'cost.view'), permissions: [...u.permissions] },
      serverTime: new Date().toISOString(),
    };
  });

  /** Sellable catalogue for the till, full or changed since `since` (product edits or stock movements). */
  app.get('/api/pos/catalog', { preHandler: requirePermission('pos.access', 'invoices.create') }, async req => {
    const u = user(req);
    const sinceRaw = (req.query as { since?: string }).since;
    const since = sinceRaw ? new Date(sinceRaw) : null;
    const serverTime = new Date().toISOString();
    let ids: number[] | undefined;
    if (since) {
      const [changed, moved] = await Promise.all([
        db.product.findMany({ where: { updatedAt: { gt: since } }, select: { id: true } }),
        db.stockLedger.findMany({ where: { branchId: u.branchId, createdAt: { gt: since } }, select: { productId: true }, distinct: ['productId'] }),
      ]);
      ids = [...new Set([...changed.map(p => p.id), ...moved.map(m => m.productId)])];
      // Combos depend on their components' stock.
      if (ids.length) ids.push(...(await db.comboItem.findMany({ where: { itemId: { in: ids } }, select: { comboId: true } })).map(c => c.comboId));
    }
    const products = await db.product.findMany({ where: { ...(ids ? { id: { in: ids } } : { isActive: true }) }, orderBy: { code: 'asc' } });
    const allIds = products.map(p => p.id);
    const [units, stocks, images, branchLinks, comboItems, bookItems] = await Promise.all([
      db.productUnit.findMany({ where: { productId: { in: allIds } } }),
      db.branchStock.findMany({ where: { branchId: u.branchId } }),
      db.productImage.findMany({ where: { productId: { in: [...allIds, ...products.map(p => p.parentId ?? 0)] }, sort: 0 } }),
      db.productBranch.findMany({ where: { productId: { in: allIds } } }),
      db.comboItem.findMany({ where: { comboId: { in: allIds } } }),
      db.priceBookItem.findMany({ where: { productId: { in: allIds } } }),
    ]);
    const onHand = (id: number) => stocks.find(s => s.productId === id)?.onHand ?? 0;
    return {
      serverTime,
      products: products.map(p => {
        const sellable = p.isActive && p.isDirectSale && !isVariantMaster(p) && (p.allBranches || branchLinks.some(b => b.productId === p.id && b.branchId === u.branchId));
        const parts = comboItems.filter(c => c.comboId === p.id);
        return {
          id: p.id, code: p.code, barcode: p.barcode, name: p.name, searchText: p.searchText, type: p.type, groupId: p.groupId, unit: p.unit, price: p.price,
          loyaltyEnabled: p.loyaltyEnabled, points: p.points, vatRate: p.vatRate, orderNoteTemplate: p.orderNoteTemplate, sellable,
          imageUrl: (images.find(i => i.productId === p.id) ?? images.find(i => i.productId === p.parentId))?.url ?? null,
          onHand: p.type === 'service' ? null : p.type === 'combo' ? (parts.length ? Math.min(...parts.map(c => Math.floor(onHand(c.itemId) / c.qty))) : 0) : onHand(p.id),
          units: units.filter(x => x.productId === p.id && x.isDirectSale).map(x => ({ id: x.id, name: x.name, conversion: x.conversion, code: x.code, barcode: x.barcode, price: x.price })),
          bookPrices: Object.fromEntries(bookItems.filter(b => b.productId === p.id).map(b => [b.priceBookId, b.price])),
        };
      }),
    };
  });

  app.get('/api/pos/customers', { preHandler: requirePermission('pos.access', 'invoices.create') }, async req => {
    const sinceRaw = (req.query as { since?: string }).since;
    const rows = await db.customer.findMany({ where: { isActive: true, ...(sinceRaw ? { updatedAt: { gt: new Date(sinceRaw) } } : {}) }, orderBy: { lastPurchaseAt: 'desc' }, take: 5000 });
    const groups = await db.customerGroup.findMany();
    return {
      serverTime: new Date().toISOString(),
      customers: rows.map(c => ({ id: c.id, code: c.code, name: c.name, phone: c.phone, searchText: c.searchText, groupId: c.groupId, groupName: groups.find(g => g.id === c.groupId)?.name ?? '', discountPercent: groups.find(g => g.id === c.groupId)?.discountPercent ?? 0, debt: c.debt, points: c.points })),
    };
  });

  // ── shifts
  app.get('/api/shifts/current', async req => {
    const u = user(req);
    return (await db.shift.findFirst({ where: { userId: u.id, branchId: u.branchId, closedAt: null } })) ?? null;
  });
  app.post('/api/shifts/open', { preHandler: requirePermission('pos.access', 'invoices.create') }, async req => {
    const { openingCash } = z.object({ openingCash: moneySchema.default(0) }).parse(req.body ?? {});
    const u = user(req);
    return db.$transaction(async tx => {
      if (await tx.shift.findFirst({ where: { userId: u.id, closedAt: null } })) throw conflict('SHIFT_OPEN', 'Bạn đang có ca làm việc chưa đóng');
      const s = await tx.shift.create({ data: { branchId: u.branchId, userId: u.id, openingCash } });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'Shift', entityId: s.id, summary: `${u.fullName} mở ca, tiền đầu ca ${openingCash.toLocaleString('en-US')}` });
      return s;
    });
  });
  app.post('/api/shifts/:id/close', { preHandler: requirePermission('pos.access', 'invoices.create') }, async req => {
    const { countedCash, note } = z.object({ countedCash: moneySchema, note: z.string().max(500).default('') }).parse(req.body);
    const u = user(req);
    return db.$transaction(async tx => {
      const s = await tx.shift.findUnique({ where: { id: idOf(req) } });
      if (!s || (s.userId !== u.id && !u.isAdmin)) throw notFound('Ca làm việc');
      if (s.closedAt) throw conflict('SHIFT_CLOSED', 'Ca đã đóng');
      const expectedCash = s.openingCash + (await drawerSince(tx, s.userId, s.branchId, s.openedAt));
      const closed = await tx.shift.update({ where: { id: s.id }, data: { closedAt: new Date(), countedCash, expectedCash, note } });
      await audit(tx, req.auditCtx, { action: 'complete', entity: 'Shift', entityId: s.id, summary: `Đóng ca: dự kiến ${expectedCash.toLocaleString('en-US')}, thực đếm ${countedCash.toLocaleString('en-US')}` });
      return closed;
    });
  });
  app.get('/api/shifts/:id/report', async (req: FastifyRequest) => {
    const s = await db.shift.findUnique({ where: { id: idOf(req) } });
    const u = user(req);
    if (!s || (s.userId !== u.id && !u.isAdmin && !hasPerm(u, 'reports.view'))) throw notFound('Ca làm việc');
    const invoices = await db.invoice.findMany({ where: { shiftId: s.id, status: { not: 'cancelled' } }, include: { payments: true } });
    const returns = await db.saleReturn.findMany({ where: { createdById: s.userId, branchId: s.branchId, status: 'completed', createdAt: { gte: s.openedAt, ...(s.closedAt ? { lte: s.closedAt } : {}) } } });
    const byMethod: Record<string, number> = {};
    for (const p of invoices.flatMap(i => i.payments)) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    const drawer = await drawerSince(db, s.userId, s.branchId, s.openedAt, s.closedAt ?? undefined);
    const owner = await db.user.findUniqueOrThrow({ where: { id: s.userId }, select: { fullName: true } });
    return {
      ...s, userName: owner.fullName, invoiceCount: invoices.length, salesTotal: invoices.reduce((t, i) => t + i.total, 0), byMethod,
      returnCount: returns.length, returnsTotal: returns.reduce((t, r) => t + r.total, 0), drawerNet: drawer,
      expectedCash: s.expectedCash ?? s.openingCash + drawer, difference: s.countedCash !== null ? s.countedCash - (s.expectedCash ?? s.openingCash + drawer) : null,
      settingsStore: (await getSettings(db)).store,
    };
  });
}
