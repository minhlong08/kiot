import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../plugins/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import type { Tx } from '../db';

const idParam = (req: { params: unknown }) => Number((req.params as { id: string }).id);

/** All descendant ids of a group (inclusive), used by product filters. */
export async function groupWithDescendants(tx: Tx, ids: number[]): Promise<number[]> {
  const all = await tx.productGroup.findMany({ select: { id: true, parentId: true } });
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of all) if (g.parentId !== null && out.has(g.parentId) && !out.has(g.id)) { out.add(g.id); grew = true; }
  }
  return [...out];
}

const groupInput = z.object({ name: z.string().trim().min(1).max(120), parentId: z.number().int().nullable().default(null), sort: z.number().int().default(0) });
const nameInput = z.object({ name: z.string().trim().min(1).max(120) });

type NamedModel = 'brand' | 'location';

function namedCrud(app: FastifyInstance, path: string, model: NamedModel, entity: string, label: string, usedBy: 'brandId' | 'locationId') {
  const db = app.prisma;
  const repo = (tx: Tx) => tx[model] as unknown as {
    findMany(a: object): Promise<{ id: number; name: string }[]>;
    findUnique(a: object): Promise<{ id: number; name: string } | null>;
    create(a: object): Promise<{ id: number; name: string }>;
    update(a: object): Promise<{ id: number; name: string }>;
    delete(a: object): Promise<unknown>;
  };

  app.get(path, async () => repo(db).findMany({ orderBy: { name: 'asc' } }));

  app.post(path, { preHandler: requirePermission('products.create', 'products.edit') }, async req => {
    const data = nameInput.parse(req.body);
    return db.$transaction(async tx => {
      const row = await repo(tx).create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity, entityId: row.id, entityCode: row.name, summary: `Tạo ${label} ${row.name}`, after: row });
      return row;
    });
  });

  app.put(`${path}/:id`, { preHandler: requirePermission('products.edit') }, async req => {
    const id = idParam(req);
    const data = nameInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await repo(tx).findUnique({ where: { id } });
      if (!before) throw notFound(label);
      const row = await repo(tx).update({ where: { id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity, entityId: id, entityCode: row.name, summary: `Sửa ${label} ${row.name}`, before, after: row });
      return row;
    });
  });

  app.delete(`${path}/:id`, { preHandler: requirePermission('products.delete') }, async req => {
    const id = idParam(req);
    return db.$transaction(async tx => {
      const before = await repo(tx).findUnique({ where: { id } });
      if (!before) throw notFound(label);
      if (await tx.product.count({ where: { [usedBy]: id } })) throw conflict('IN_USE', `${label} đang được sử dụng`);
      await repo(tx).delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity, entityId: id, entityCode: before.name, summary: `Xóa ${label} ${before.name}`, before });
      return { ok: true };
    });
  });
}

export async function catalogRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/product-groups', async () => {
    const [groups, counts] = await Promise.all([
      db.productGroup.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
      db.product.groupBy({ by: ['groupId'], _count: { _all: true }, where: { isActive: true } }),
    ]);
    const byGroup = new Map(counts.map(c => [c.groupId, c._count._all]));
    return groups.map(g => ({ ...g, productCount: byGroup.get(g.id) ?? 0 }));
  });

  async function checkParent(tx: Tx, id: number | null, parentId: number | null) {
    if (parentId === null) return;
    if (!(await tx.productGroup.findUnique({ where: { id: parentId } }))) throw notFound('Nhóm cha');
    if (id !== null && (await groupWithDescendants(tx, [id])).includes(parentId)) {
      throw badRequest('INVALID_PARENT', 'Không thể chọn nhóm con làm nhóm cha');
    }
  }

  app.post('/api/product-groups', { preHandler: requirePermission('products.create', 'products.edit') }, async req => {
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      await checkParent(tx, null, data.parentId);
      const g = await tx.productGroup.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'ProductGroup', entityId: g.id, entityCode: g.name, summary: `Tạo nhóm hàng ${g.name}`, after: g });
      return g;
    });
  });

  app.put('/api/product-groups/:id', { preHandler: requirePermission('products.edit') }, async req => {
    const id = idParam(req);
    const data = groupInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.productGroup.findUnique({ where: { id } });
      if (!before) throw notFound('Nhóm hàng');
      await checkParent(tx, id, data.parentId);
      const g = await tx.productGroup.update({ where: { id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'ProductGroup', entityId: id, entityCode: g.name, summary: `Sửa nhóm hàng ${g.name}`, before, after: g });
      return g;
    });
  });

  app.delete('/api/product-groups/:id', { preHandler: requirePermission('products.delete') }, async req => {
    const id = idParam(req);
    return db.$transaction(async tx => {
      const before = await tx.productGroup.findUnique({ where: { id } });
      if (!before) throw notFound('Nhóm hàng');
      const [children, products] = await Promise.all([tx.productGroup.count({ where: { parentId: id } }), tx.product.count({ where: { groupId: id } })]);
      if (children || products) throw conflict('GROUP_IN_USE', 'Nhóm hàng đang có nhóm con hoặc hàng hóa');
      await tx.productGroup.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'ProductGroup', entityId: id, entityCode: before.name, summary: `Xóa nhóm hàng ${before.name}`, before });
      return { ok: true };
    });
  });

  namedCrud(app, '/api/brands', 'brand', 'Brand', 'thương hiệu', 'brandId');
  namedCrud(app, '/api/locations', 'location', 'Location', 'vị trí', 'locationId');
}
