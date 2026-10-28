import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDateTime, normalizeVi, productInputSchema } from '@pd/shared';
import { Prisma } from '../db';
import type { Tx } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { dateParam, listParam, orderByOf, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { deleteProduct, expectedOutDates, saveProduct } from '../services/products';
import { groupWithDescendants } from './catalog';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const boolParam = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Shared filter → Prisma where, used by list, totals and export. Masters with variants are hidden (their children are listed). */
async function productWhere(tx: Tx, q: Record<string, unknown>, branchId: number): Promise<Prisma.ProductWhereInput> {
  const search = typeof q.search === 'string' && q.search.trim() ? normalizeVi(q.search) : undefined;
  const status = (q.status as string) ?? 'active';
  const groupIds = listParam(q.groupIds)?.map(Number);
  const brandIds = listParam(q.brandIds)?.map(Number);
  const types = listParam(q.types);
  const from = dateParam(q.createdFrom), to = dateParam(q.createdTo);
  const where: Prisma.ProductWhereInput = {
    NOT: { parentId: null, attributes: { not: '[]' } },
    ...(status === 'all' ? {} : { isActive: status === 'active' }),
    ...(search ? { searchText: { contains: search } } : {}),
    ...(groupIds ? { groupId: { in: await groupWithDescendants(tx, groupIds) } } : {}),
    ...(brandIds ? { brandId: { in: brandIds } } : {}),
    ...(types ? { type: { in: types } } : {}),
    ...(boolParam(q.isDirectSale) !== undefined ? { isDirectSale: boolParam(q.isDirectSale) } : {}),
    ...(boolParam(q.loyalty) !== undefined ? { loyaltyEnabled: boolParam(q.loyalty) } : {}),
    ...(boolParam(q.sellOnline) !== undefined ? { sellOnline: boolParam(q.sellOnline) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
  const stock = q.stock as string | undefined;
  if (stock && stock !== 'all') {
    const cond = {
      inStock: Prisma.sql`COALESCE(s."onHand", 0) > 0`,
      outOfStock: Prisma.sql`COALESCE(s."onHand", 0) <= 0`,
      belowMin: Prisma.sql`COALESCE(s."onHand", 0) < p."minStock"`,
      aboveMax: Prisma.sql`COALESCE(s."onHand", 0) > p."maxStock"`,
    }[stock];
    if (cond) {
      const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT p."id" AS id FROM "Product" p
        LEFT JOIN "BranchStock" s ON s."productId" = p."id" AND s."branchId" = ${branchId}
        WHERE p."type" = 'goods' AND ${cond}`;
      where.id = { in: rows.map(r => Number(r.id)) };
    }
  }
  return where;
}

type Stock = { onHand: number; reserved: number; incoming: number; cost: number };

async function stocksFor(tx: Tx, products: { id: number; type: string }[], branchId: number) {
  const ids = products.map(p => p.id);
  const combos = products.filter(p => p.type === 'combo').map(p => p.id);
  const items = combos.length ? await tx.comboItem.findMany({ where: { comboId: { in: combos } } }) : [];
  const allIds = [...new Set([...ids, ...items.map(i => i.itemId)])];
  const rows = await tx.branchStock.findMany({ where: { branchId, productId: { in: allIds } } });
  const byId = new Map<number, Stock>(rows.map(r => [r.productId, r]));
  // A combo's availability is limited by its scarcest component.
  for (const c of combos) {
    const parts = items.filter(i => i.comboId === c);
    const onHand = parts.length ? Math.min(...parts.map(i => Math.floor((byId.get(i.itemId)?.onHand ?? 0) / i.qty))) : 0;
    const cost = parts.reduce((s, i) => s + (byId.get(i.itemId)?.cost ?? 0) * i.qty, 0);
    byId.set(c, { onHand: Math.max(onHand, 0), reserved: 0, incoming: 0, cost });
  }
  return byId;
}

export async function productRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const canCost = (req: FastifyRequest) => hasPerm(req.user, 'cost.view');

  async function listRows(req: FastifyRequest, where: Prisma.ProductWhereInput, page?: { skip: number; take: number; sort?: string }) {
    const u = user(req);
    const products = await db.product.findMany({
      where,
      orderBy: orderByOf(page?.sort, ['code', 'name', 'price', 'cost', 'createdAt'], { createdAt: 'desc' }),
      ...(page ? { skip: page.skip, take: page.take } : {}),
    });
    const ids = products.map(p => p.id);
    const [stocks, images, groups, brands] = await Promise.all([
      stocksFor(db, products, u.branchId),
      db.productImage.findMany({ where: { productId: { in: [...ids, ...products.map(p => p.parentId ?? 0)] } }, orderBy: { sort: 'asc' } }),
      db.productGroup.findMany(),
      db.brand.findMany(),
    ]);
    const outDates = await expectedOutDates(db, products.map(p => ({ id: p.id, onHand: stocks.get(p.id)?.onHand ?? 0 })), u.branchId);
    const showCost = canCost(req);
    return products.map(p => {
      const s = stocks.get(p.id);
      const img = images.find(i => i.productId === p.id) ?? images.find(i => i.productId === p.parentId);
      return {
        id: p.id, code: p.code, barcode: p.barcode, name: p.name, type: p.type, unit: p.unit, parentId: p.parentId,
        imageUrl: img?.url ?? null, groupId: p.groupId, groupName: groups.find(g => g.id === p.groupId)?.name ?? '',
        brandName: brands.find(b => b.id === p.brandId)?.name ?? '',
        price: p.price, ...(showCost ? { cost: s && p.type !== 'service' ? s.cost || p.cost : p.cost } : {}),
        onHand: p.type === 'service' ? 0 : s?.onHand ?? 0, reserved: s?.reserved ?? 0, incoming: s?.incoming ?? 0,
        minStock: p.minStock, maxStock: p.maxStock, isActive: p.isActive, isDirectSale: p.isDirectSale, loyaltyEnabled: p.loyaltyEnabled,
        createdAt: p.createdAt, expectedOutDate: outDates.get(p.id) ?? null,
      };
    });
  }

  app.get('/api/products', { preHandler: requirePermission('products.view') }, async req => {
    const q = parseList(req.query);
    const u = user(req);
    const where = await productWhere(db, req.query as Record<string, unknown>, u.branchId);
    const [items, total, idRows] = await Promise.all([
      listRows(req, where, { skip: q.skip, take: q.take, sort: q.sort }),
      db.product.count({ where }),
      db.product.findMany({ where: { ...where, type: 'goods' }, select: { id: true } }),
    ]);
    const sums = await db.branchStock.aggregate({ _sum: { onHand: true, reserved: true }, where: { branchId: u.branchId, productId: { in: idRows.map(r => r.id) } } });
    return { items, total, totals: { onHand: sums._sum.onHand ?? 0, reserved: sums._sum.reserved ?? 0 } };
  });

  app.get('/api/products/export', { preHandler: requirePermission('products.export', 'products.view') }, async (req, reply) => {
    const where = await productWhere(db, req.query as Record<string, unknown>, user(req).branchId);
    const rows = await listRows(req, where);
    const showCost = canCost(req);
    return sendXlsx(reply, 'danh-sach-hang-hoa.xlsx', [
      { header: 'Mã hàng', key: 'code' }, { header: 'Mã vạch', key: 'barcode' }, { header: 'Tên hàng', key: 'name', width: 40 },
      { header: 'Nhóm hàng', key: 'groupName' }, { header: 'Thương hiệu', key: 'brandName' }, { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'Giá bán', key: 'price', money: true }, ...(showCost ? [{ header: 'Giá vốn', key: 'cost', money: true }] : []),
      { header: 'Tồn kho', key: 'onHand' }, { header: 'Khách đặt', key: 'reserved' }, { header: 'Thời gian tạo', key: 'created' },
    ], rows.map(r => ({ ...r, created: formatDateTime(r.createdAt) })));
  });

  app.get('/api/products/lookup', async req => {
    const { q = '', pos } = req.query as { q?: string; pos?: string };
    const u = user(req);
    const text = q.trim();
    if (!text) return [];
    const base: Prisma.ProductWhereInput = { isActive: true, NOT: { parentId: null, attributes: { not: '[]' } }, ...(pos === '1' ? { isDirectSale: true } : {}) };
    const [exact, exactUnits, matches] = await Promise.all([
      db.product.findMany({ where: { ...base, OR: [{ code: text }, { barcode: text }] } }),
      db.productUnit.findMany({ where: { OR: [{ code: text }, { barcode: text }] } }),
      db.product.findMany({ where: { ...base, searchText: { contains: normalizeVi(text) } }, take: 20, orderBy: { code: 'asc' } }),
    ]);
    const unitParents = await db.product.findMany({ where: { ...base, id: { in: exactUnits.map(u => u.productId) } } });
    const products = [...new Map([...exact, ...unitParents, ...matches].map(p => [p.id, p])).values()];
    const units = await db.productUnit.findMany({ where: { productId: { in: products.map(p => p.id) }, ...(pos === '1' ? { isDirectSale: true } : {}) } });
    const stocks = await stocksFor(db, products, u.branchId);
    const images = await db.productImage.findMany({ where: { productId: { in: [...products.map(p => p.id), ...products.map(p => p.parentId ?? 0)] } }, orderBy: { sort: 'asc' } });
    const showCost = canCost(req);
    const rowOf = (p: (typeof products)[number], unit?: (typeof units)[number]) => {
      const s = stocks.get(p.id);
      const conversion = unit?.conversion ?? 1;
      return {
        productId: p.id, unitId: unit?.id ?? null, code: unit?.code ?? p.code, barcode: unit?.barcode ?? p.barcode, name: p.name, type: p.type,
        unitName: unit?.name ?? p.unit, conversion, price: unit?.price ?? p.price,
        ...(showCost ? { cost: (s?.cost || p.cost) * conversion } : {}),
        onHand: p.type === 'service' ? null : Math.floor((s?.onHand ?? 0) / conversion),
        imageUrl: (images.find(i => i.productId === p.id) ?? images.find(i => i.productId === p.parentId))?.url ?? null,
        loyaltyEnabled: p.loyaltyEnabled, points: p.points, vatRate: p.vatRate, orderNoteTemplate: p.orderNoteTemplate,
      };
    };
    const rows = products.flatMap(p => [rowOf(p), ...units.filter(un => un.productId === p.id).map(un => rowOf(p, un))]);
    const isExact = (r: ReturnType<typeof rowOf>) => r.code === text || r.barcode === text;
    return [...rows.filter(isExact), ...rows.filter(r => !isExact(r))].slice(0, 20);
  });

  async function productDetail(req: FastifyRequest, id: number) {
    const p = await db.product.findUnique({ where: { id } });
    if (!p) throw notFound('Hàng hóa');
    const [units, comboRows, images, warranties, children, stockRows, branches, productBranches] = await Promise.all([
      db.productUnit.findMany({ where: { productId: id }, orderBy: { conversion: 'asc' } }),
      db.comboItem.findMany({ where: { comboId: id } }),
      db.productImage.findMany({ where: { productId: id }, orderBy: { sort: 'asc' } }),
      db.productWarranty.findMany({ where: { productId: id } }),
      db.product.findMany({ where: { parentId: id }, orderBy: { id: 'asc' } }),
      db.branchStock.findMany({ where: { productId: id } }),
      db.branch.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      db.productBranch.findMany({ where: { productId: id } }),
    ]);
    const comboProducts = await db.product.findMany({ where: { id: { in: comboRows.map(c => c.itemId) } } });
    const childStocks = await db.branchStock.findMany({ where: { productId: { in: children.map(c => c.id) }, branchId: user(req).branchId } });
    const showCost = canCost(req);
    const { cost, ...rest } = p;
    return {
      ...rest, ...(showCost ? { cost } : {}),
      attributes: JSON.parse(p.attributes),
      images: images.map(i => i.url),
      units, warranties,
      branchIds: productBranches.map(b => b.branchId),
      comboItems: comboRows.map(c => {
        const it = comboProducts.find(x => x.id === c.itemId)!;
        return { itemId: c.itemId, qty: c.qty, code: it.code, name: it.name, price: it.price, ...(showCost ? { cost: it.cost } : {}) };
      }),
      variants: children.map(c => ({
        id: c.id, code: c.code, barcode: c.barcode, price: c.price, ...(showCost ? { cost: c.cost } : {}), isActive: c.isActive,
        values: (JSON.parse(c.attributes) as { value: string }[]).map(a => a.value),
        onHand: childStocks.find(s => s.productId === c.id)?.onHand ?? 0,
      })),
      stocks: branches.map(b => {
        const s = stockRows.find(r => r.branchId === b.id);
        return { branchId: b.id, branchName: b.name, onHand: s?.onHand ?? 0, reserved: s?.reserved ?? 0, incoming: s?.incoming ?? 0, ...(showCost ? { cost: s?.cost ?? p.cost } : {}) };
      }),
    };
  }

  app.get('/api/products/:id', { preHandler: requirePermission('products.view') }, async req => productDetail(req, idOf(req)));

  app.get('/api/products/:id/stock-card', { preHandler: requirePermission('products.view') }, async req => {
    const id = idOf(req);
    const q = parseList(req.query);
    const branchId = Number((req.query as { branchId?: string }).branchId) || user(req).branchId;
    const where = { productId: id, branchId };
    const [items, total] = await Promise.all([
      db.stockLedger.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }),
      db.stockLedger.count({ where }),
    ]);
    const showCost = canCost(req);
    return { items: items.map(({ unitCost, costAfter, ...r }) => ({ ...r, ...(showCost ? { unitCost, costAfter } : {}) })), total };
  });

  const ctxOf = (req: FastifyRequest) => ({ ...req.auditCtx, branchId: user(req).branchId });

  app.post('/api/products', { preHandler: requirePermission('products.create') }, async req => {
    const input = productInputSchema.parse(req.body);
    return db.$transaction(tx => saveProduct(tx, ctxOf(req), input));
  });

  app.put('/api/products/:id', { preHandler: requirePermission('products.edit') }, async req => {
    const input = productInputSchema.parse(req.body);
    return db.$transaction(tx => saveProduct(tx, ctxOf(req), input, idOf(req)));
  });

  app.post('/api/products/:id/copy', { preHandler: requirePermission('products.create') }, async req => {
    const d = await productDetail(req, idOf(req));
    const { id: _id, code: _code, barcode: _barcode, createdAt: _c, updatedAt: _u, searchText: _s, parentId: _p, variantLabel: _v, stocks: _st, isActive: _a, ...rest } = d;
    return {
      ...rest,
      units: d.units.map((un: { name: string; conversion: number; price: number; isDirectSale: boolean }) => ({ name: un.name, conversion: un.conversion, price: un.price, isDirectSale: un.isDirectSale })),
      variants: d.variants.filter((v: { isActive: boolean }) => v.isActive).map((v: { values: string[]; price: number; cost?: number }) => ({ values: v.values, price: v.price, cost: v.cost ?? 0 })),
      comboItems: d.comboItems.map((c: { itemId: number; qty: number }) => ({ itemId: c.itemId, qty: c.qty })),
      warranties: d.warranties.map((w: { kind: string; name: string; duration: number; durationUnit: string }) => ({ kind: w.kind, name: w.name, duration: w.duration, durationUnit: w.durationUnit })),
    };
  });

  const bulkInput = z.object({ ids: z.array(z.number().int()).min(1), action: z.enum(['activate', 'deactivate', 'delete', 'setGroup']), groupId: z.number().int().optional() });
  app.post('/api/products/bulk', { preHandler: requirePermission('products.edit') }, async req => {
    const b = bulkInput.parse(req.body);
    return db.$transaction(async tx => {
      if (b.action === 'delete') {
        const results = [];
        for (const id of b.ids) results.push(await deleteProduct(tx, req.auditCtx, id));
        return { ok: true, deleted: results.filter(r => 'deleted' in r).length, deactivated: results.filter(r => 'deactivated' in r).length };
      }
      const allIds = [...b.ids, ...(await tx.product.findMany({ where: { parentId: { in: b.ids } }, select: { id: true } })).map(c => c.id)];
      const data = b.action === 'setGroup' ? { groupId: b.groupId ?? null } : { isActive: b.action === 'activate' };
      await tx.product.updateMany({ where: { id: { in: allIds } }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Product', entityId: b.ids.join(','), summary: `Cập nhật hàng loạt (${b.action}) ${b.ids.length} hàng hóa`, after: data });
      return { ok: true };
    });
  });

  app.delete('/api/products/:id', { preHandler: requirePermission('products.delete') }, async req =>
    db.$transaction(tx => deleteProduct(tx, req.auditCtx, idOf(req))));
}
