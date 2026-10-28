import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ALL_PERMS } from '@pd/shared';
import { requirePermission } from '../plugins/auth';
import { conflict, notFound } from '../lib/errors';
import { audit } from '../services/audit';

const roleInput = z.object({
  name: z.string().trim().min(1).max(80),
  maxDiscountPercent: z.number().int().min(0).max(100).default(0),
  permissions: z.array(z.string().refine(k => ALL_PERMS.includes(k), 'Quyền không hợp lệ')).default([]),
});

const shape = (r: { id: number; name: string; isAdmin: boolean; maxDiscountPercent: number; permissions: { key: string }[]; _count?: { users: number } }) => ({
  id: r.id, name: r.name, isAdmin: r.isAdmin, maxDiscountPercent: r.maxDiscountPercent,
  permissions: r.permissions.map(p => p.key), userCount: r._count?.users ?? 0,
});

export async function roleRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/roles', { preHandler: requirePermission('settings.view', 'employees.view') }, async () => {
    const roles = await db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { id: 'asc' } });
    return { items: roles.map(shape), total: roles.length };
  });

  app.post('/api/roles', { preHandler: requirePermission('settings.edit') }, async req => {
    const { permissions, ...data } = roleInput.parse(req.body);
    return db.$transaction(async tx => {
      const r = await tx.role.create({ data: { ...data, permissions: { create: permissions.map(key => ({ key })) } }, include: { permissions: true } });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'Role', entityId: r.id, entityCode: r.name, summary: `Tạo vai trò ${r.name}`, after: shape(r) });
      return shape(r);
    });
  });

  app.put('/api/roles/:id', { preHandler: requirePermission('settings.edit') }, async req => {
    const id = Number((req.params as { id: string }).id);
    const { permissions, ...data } = roleInput.partial().parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.role.findUnique({ where: { id }, include: { permissions: true } });
      if (!before) throw notFound('Vai trò');
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: permissions.map(key => ({ roleId: id, key })) });
      }
      const r = await tx.role.update({ where: { id }, data, include: { permissions: true } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Role', entityId: id, entityCode: r.name, summary: `Sửa vai trò ${r.name}`, before: shape(before), after: shape(r) });
      return shape(r);
    });
  });

  app.delete('/api/roles/:id', { preHandler: requirePermission('settings.delete') }, async req => {
    const id = Number((req.params as { id: string }).id);
    return db.$transaction(async tx => {
      const r = await tx.role.findUnique({ where: { id }, include: { permissions: true, _count: { select: { users: true } } } });
      if (!r) throw notFound('Vai trò');
      if (r._count.users > 0) throw conflict('ROLE_IN_USE', 'Vai trò đang được gán cho người dùng');
      if (r.isAdmin) throw conflict('ROLE_IN_USE', 'Không thể xóa vai trò quản trị');
      await tx.role.delete({ where: { id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Role', entityId: id, entityCode: r.name, summary: `Xóa vai trò ${r.name}`, before: shape(r) });
      return { ok: true };
    });
  });
}
