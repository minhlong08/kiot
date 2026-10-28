import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { normalizeVi } from '@pd/shared';
import { requirePermission } from '../plugins/auth';
import { orderByOf, parseList } from '../lib/list';
import { notFound } from '../lib/errors';
import { audit } from '../services/audit';

const branchInput = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(300).default(''),
  isActive: z.boolean().default(true),
});

export async function branchRoutes(app: FastifyInstance) {
  const db = app.prisma;

  // Any signed-in user may read branches (needed for pickers); editing needs settings permission.
  app.get('/api/branches', async req => {
    const q = parseList(req.query);
    const all = await db.branch.findMany({ orderBy: orderByOf(q.sort, ['code', 'name', 'createdAt'], { id: 'asc' }) });
    const filtered = q.searchNorm ? all.filter(b => normalizeVi(`${b.code} ${b.name}`).includes(q.searchNorm!)) : all;
    return { items: filtered.slice(q.skip, q.skip + q.take), total: filtered.length };
  });

  app.post('/api/branches', { preHandler: requirePermission('settings.edit') }, async req => {
    const data = branchInput.parse(req.body);
    return db.$transaction(async tx => {
      const b = await tx.branch.create({ data });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'Branch', entityId: b.id, entityCode: b.code, summary: `Tạo chi nhánh ${b.name}`, after: b });
      return b;
    });
  });

  app.put('/api/branches/:id', { preHandler: requirePermission('settings.edit') }, async req => {
    const id = Number((req.params as { id: string }).id);
    const data = branchInput.partial().parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound('Chi nhánh');
      const b = await tx.branch.update({ where: { id }, data });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Branch', entityId: id, entityCode: b.code, summary: `Sửa chi nhánh ${b.name}`, before, after: b });
      return b;
    });
  });

  app.delete('/api/branches/:id', { preHandler: requirePermission('settings.delete') }, async req => {
    const id = Number((req.params as { id: string }).id);
    return db.$transaction(async tx => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound('Chi nhánh');
      // Branches are referenced by documents and sessions; deleting = deactivating keeps history intact.
      const b = await tx.branch.update({ where: { id }, data: { isActive: false } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Branch', entityId: id, entityCode: b.code, summary: `Ngừng hoạt động chi nhánh ${b.name}`, before, after: b });
      return { ok: true };
    });
  });
}
