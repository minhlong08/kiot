import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { applyPriceFormula, moneySchema, normalizeVi } from '@pd/shared';
import type { Prisma } from '../db';
import { hasPerm, requirePermission, user } from '../plugins/auth';
import { listParam, parseList } from '../lib/list';
import { AppError, badRequest, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { applicablePriceBooks } from '../services/priceBooks';
import { groupWithDescendants } from './catalog';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const bookInput = z.object({
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean().default(true),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  branchIds: z.array(z.number().int()).default([]),
  customerGroupIds: z.array(z.number().int()).default([]),
  userIds: z.array(z.number().int()).default([]),
  allowOutsideItems: z.boolean().default(true),
});
const toData = (b: z.infer<typeof bookInput>) => ({
  ...b, startAt: b.startAt ? new Date(b.startAt) : null, endAt: b.endAt ? new Date(b.endAt) : null,
  branchIds: JSON.stringify(b.branchIds), customerGroupIds: JSON.stringify(b.customerGroupIds), userIds: JSON.stringify(b.userIds),
});
const shape = <T extends { branchIds: string; customerGroupIds: string; userIds: string }>(b: T) => ({
  ...b, branchIds: JSON.parse(b.branchIds) as number[], customerGroupIds: JSON.parse(b.customerGroupIds) as number[], userIds: JSON.parse(b.userIds) as number[],
});

export async function priceBookRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/price-books', async req => {
    const books = await db.priceBook.findMany({ orderBy: { name: 'asc' } });
    const counts = await db.priceBookItem.groupBy({ by: ['priceBookId'], _count: { _all: true } });
    const rows = books.map(b => ({ ...shape(b), itemCount: counts.find(c => c.priceBookId === b.id)?._count._all ?? 0 }));
    // POS asks only for the books usable right now by this user at this branch.
    if ((req.query as { applicable?: string }).applicable === '1') {
      const u = user(req);
      const groupId = Number((req.query as { customerGroupId?: string }).customerGroupId) || null;
      const ok = new Set((await applicablePriceBooks(db, { branchId: u.branchId, userId: u.id, customerGroupId: groupId, at: new Date() })).map(b => b.id));
      return rows.filter(r => ok.has(r.id));
    }
    return rows;
  });

  app.post('/api/price-books', { preHandler: requirePermission('priceBooks.create') }, async req => {
    const b = bookInput.parse(req.body);
    return db.$transaction(async tx => {
      const row = await tx.priceBook.create({ data: toData(b) });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'PriceBook', entityId: row.id, entityCode: row.name, summary: `Tạo bảng giá ${row.name}`, after: row });
      return shape(row);
    });
  });

  app.put('/api/price-books/:id', { preHandler: requirePermission('priceBooks.edit') }, async req => {
    const id = idOf(req);
    const b = bookInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.priceBook.findUnique({ where: { id } });
      if (!before) throw notFound('Bảng giá');
      const row = await tx.priceBook.update({ where: { id }, data: toData(b) });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'PriceBook', entityId: id, entityCode: row.name, summary: `Sửa bảng giá ${row.name}`, before, after: row });
      return shape(row);
    });
  });

  app.delete('/api/price-books/:id', { preHandler: requirePermission('priceBooks.delete') }, async req => {
    const id = idOf(req);
    return db.$transaction(async tx => {
      const before = await tx.priceBook.findUnique({ where: { id } });
      if (!before) throw notFound('Bảng giá');
      await tx.priceBookItem.deleteMany({ where: { priceBookId: id } });
      await tx.priceBook.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'PriceBook', entityId: id, entityCode: before.name, summary: `Xóa bảng giá ${before.name}`, before });
      return { ok: true };
    });
  });

  async function productFilter(q: Record<string, unknown>): Promise<Prisma.ProductWhereInput> {
    const search = typeof q.search === 'string' && q.search.trim() ? normalizeVi(q.search) : undefined;
    const groupIds = listParam(q.groupIds)?.map(Number);
    return {
      isActive: true, type: { not: 'combo' }, NOT: { parentId: null, attributes: { not: '[]' } },
      ...(search ? { searchText: { contains: search } } : {}),
      ...(groupIds ? { groupId: { in: await groupWithDescendants(db, groupIds) } } : {}),
    };
  }

  /** All active products with this book's price (null = not in the book). bookIds lets the grid show several books side by side. */
  app.get('/api/price-books/:id/items', { preHandler: requirePermission('priceBooks.view') }, async req => {
    const q = parseList(req.query);
    const where = await productFilter(req.query as Record<string, unknown>);
    const bookIds = [idOf(req), ...(listParam((req.query as { bookIds?: string }).bookIds)?.map(Number) ?? [])];
    const [products, total] = await Promise.all([db.product.findMany({ where, orderBy: { code: 'asc' }, skip: q.skip, take: q.take }), db.product.count({ where })]);
    const items = await db.priceBookItem.findMany({ where: { priceBookId: { in: bookIds }, productId: { in: products.map(p => p.id) } } });
    const stocks = await db.branchStock.findMany({ where: { branchId: user(req).branchId, productId: { in: products.map(p => p.id) } } });
    const showCost = hasPerm(req.user, 'cost.view');
    return {
      items: products.map(p => ({
        productId: p.id, code: p.code, name: p.name, basePrice: p.price,
        ...(showCost ? { cost: stocks.find(s => s.productId === p.id)?.cost || p.cost } : {}),
        price: items.find(i => i.productId === p.id && i.priceBookId === bookIds[0])?.price ?? null,
        prices: Object.fromEntries(bookIds.map(b => [b, items.find(i => i.productId === p.id && i.priceBookId === b)?.price ?? null])),
      })),
      total,
    };
  });

  const itemsInput = z.object({ items: z.array(z.object({ productId: z.number().int(), price: moneySchema.nullable() })).min(1) });
  app.put('/api/price-books/:id/items', { preHandler: requirePermission('priceBooks.edit') }, async req => {
    const id = idOf(req);
    const { items } = itemsInput.parse(req.body);
    return db.$transaction(async tx => {
      const book = await tx.priceBook.findUnique({ where: { id } });
      if (!book) throw notFound('Bảng giá');
      for (const it of items) {
        if (it.price === null) await tx.priceBookItem.deleteMany({ where: { priceBookId: id, productId: it.productId } });
        else await tx.priceBookItem.upsert({ where: { priceBookId_productId: { priceBookId: id, productId: it.productId } }, create: { priceBookId: id, productId: it.productId, price: it.price }, update: { price: it.price } });
      }
      await audit(tx, req.auditCtx, { action: 'update', entity: 'PriceBook', entityId: id, entityCode: book.name, summary: `Cập nhật giá ${items.length} hàng hóa trong bảng giá ${book.name}` });
      return { ok: true };
    });
  });

  const formulaInput = z.object({
    productIds: z.array(z.number().int()).optional(),
    groupIds: z.array(z.number().int()).optional(),
    search: z.string().optional(),
    base: z.enum(['cost', 'price', 'book']),
    baseBookId: z.number().int().optional(),
    op: z.enum(['+', '-']),
    value: z.number().min(0).max(1_000_000_000),
    unit: z.enum(['%', 'VND']),
    roundTo: z.union([z.literal(0), z.literal(100), z.literal(1000)]).default(0),
  });
  app.post('/api/price-books/:id/apply-formula', { preHandler: requirePermission('priceBooks.edit') }, async req => {
    const id = idOf(req);
    const f = formulaInput.parse(req.body);
    if (f.base === 'book' && !f.baseBookId) throw badRequest('NO_BASE_BOOK', 'Chọn bảng giá gốc');
    if (f.base === 'cost' && !hasPerm(req.user, 'cost.view')) throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền xem giá vốn');
    return db.$transaction(async tx => {
      const book = await tx.priceBook.findUnique({ where: { id } });
      if (!book) throw notFound('Bảng giá');
      const where = f.productIds ? { id: { in: f.productIds } } : await productFilter({ search: f.search, groupIds: f.groupIds?.join(',') });
      const products = await tx.product.findMany({ where });
      const branchId = user(req).branchId;
      const stocks = await tx.branchStock.findMany({ where: { branchId, productId: { in: products.map(p => p.id) } } });
      const baseItems = f.base === 'book' ? await tx.priceBookItem.findMany({ where: { priceBookId: f.baseBookId!, productId: { in: products.map(p => p.id) } } }) : [];
      for (const p of products) {
        const base = f.base === 'cost' ? stocks.find(s => s.productId === p.id)?.cost || p.cost
          : f.base === 'price' ? p.price
          : baseItems.find(i => i.productId === p.id)?.price ?? p.price;
        const price = applyPriceFormula(base, f.op, f.value, f.unit, f.roundTo);
        await tx.priceBookItem.upsert({ where: { priceBookId_productId: { priceBookId: id, productId: p.id } }, create: { priceBookId: id, productId: p.id, price }, update: { price } });
      }
      await audit(tx, req.auditCtx, { action: 'update', entity: 'PriceBook', entityId: id, entityCode: book.name, summary: `Áp dụng công thức giá cho ${products.length} hàng hóa (${f.base} ${f.op} ${f.value}${f.unit})` });
      return { updated: products.length };
    });
  });
}
