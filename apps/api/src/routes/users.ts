import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { normalizeVi } from '@pd/shared';
import { requirePermission } from '../plugins/auth';
import { parseList } from '../lib/list';
import { notFound } from '../lib/errors';
import { audit } from '../services/audit';
import type { Tx } from '../db';
import type { AuthUser } from '../plugins/auth';
import { AppError } from '../lib/errors';

const forbidden = (msg: string) => new AppError(403, 'FORBIDDEN', msg);

/** Only admins may create, change or reset admin accounts, or hand out an admin role. */
async function guardAdminChange(tx: Tx, actor: AuthUser, target: { roleId: number } | null, newRoleId?: number) {
  if (actor.isAdmin) return;
  const roleIds = [target?.roleId, newRoleId].filter((v): v is number => v !== undefined);
  const adminRoles = await tx.role.count({ where: { id: { in: roleIds }, isAdmin: true } });
  if (adminRoles) throw forbidden('Chỉ quản trị viên mới được thay đổi tài khoản quản trị');
}

/** Refuses changes that would leave the system without an active admin. */
async function guardLastAdmin(tx: Tx, userId: number, next: { isActive?: boolean; roleId?: number }) {
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } });
  if (!u.isActive || !u.role.isAdmin) return;
  const losesAdmin = next.isActive === false
    || (next.roleId !== undefined && !(await tx.role.findUnique({ where: { id: next.roleId } }))?.isAdmin);
  if (!losesAdmin) return;
  const others = await tx.user.count({ where: { id: { not: userId }, isActive: true, role: { isAdmin: true } } });
  if (!others) throw new AppError(409, 'LAST_ADMIN', 'Phải còn ít nhất một quản trị viên đang hoạt động');
}

const optional = z.string().trim().max(120).transform(v => v || null).nullable().optional();
const userInput = z.object({
  username: z.string().trim().min(2).max(50),
  fullName: z.string().trim().min(1).max(120),
  phone: optional,
  email: optional,
  password: z.string().min(6),
  roleId: z.number().int(),
  branchIds: z.array(z.number().int()).min(1, 'Chọn ít nhất một chi nhánh'),
  defaultBranchId: z.number().int().optional(),
  isActive: z.boolean().default(true),
});

const include = { role: { select: { id: true, name: true } }, branchAccess: { select: { branchId: true } } } as const;
type UserRow = Awaited<ReturnType<Tx['user']['findFirstOrThrow']>> & { role: { id: number; name: string }; branchAccess: { branchId: number }[] };

const shape = (u: UserRow) => ({
  id: u.id, username: u.username, fullName: u.fullName, phone: u.phone, email: u.email, isActive: u.isActive,
  mustChangePassword: u.mustChangePassword, roleId: u.roleId, roleName: u.role.name, defaultBranchId: u.defaultBranchId,
  branchIds: u.branchAccess.map(b => b.branchId), createdAt: u.createdAt,
});

export async function userRoutes(app: FastifyInstance) {
  const db = app.prisma;

  app.get('/api/users', { preHandler: requirePermission('settings.view', 'employees.view') }, async req => {
    const q = parseList(req.query);
    const all = (await db.user.findMany({ include, orderBy: { id: 'asc' } })) as UserRow[];
    const filtered = q.searchNorm ? all.filter(u => normalizeVi(`${u.username} ${u.fullName} ${u.phone ?? ''}`).includes(q.searchNorm!)) : all;
    return { items: filtered.slice(q.skip, q.skip + q.take).map(shape), total: filtered.length };
  });

  app.post('/api/users', { preHandler: requirePermission('settings.edit') }, async req => {
    const { password, branchIds, ...data } = userInput.parse(req.body);
    return db.$transaction(async tx => {
      await guardAdminChange(tx, req.user!, null, data.roleId);
      const u = (await tx.user.create({
        data: {
          ...data, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true,
          defaultBranchId: data.defaultBranchId ?? branchIds[0], branchAccess: { create: branchIds.map(branchId => ({ branchId })) },
        },
        include,
      })) as UserRow;
      await audit(tx, req.auditCtx, { action: 'create', entity: 'User', entityId: u.id, entityCode: u.username, summary: `Tạo người dùng ${u.fullName}`, after: shape(u) });
      return shape(u);
    });
  });

  app.put('/api/users/:id', { preHandler: requirePermission('settings.edit') }, async req => {
    const id = Number((req.params as { id: string }).id);
    const { password: _ignored, branchIds, ...data } = userInput.partial().parse(req.body);
    return db.$transaction(async tx => {
      const before = (await tx.user.findUnique({ where: { id }, include })) as UserRow | null;
      if (!before) throw notFound('Người dùng');
      await guardAdminChange(tx, req.user!, before, data.roleId);
      await guardLastAdmin(tx, id, data);
      if (branchIds) {
        await tx.userBranch.deleteMany({ where: { userId: id } });
        await tx.userBranch.createMany({ data: branchIds.map(branchId => ({ userId: id, branchId })) });
      }
      const u = (await tx.user.update({ where: { id }, data, include })) as UserRow;
      if (data.isActive === false || data.roleId !== undefined) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'User', entityId: id, entityCode: u.username, summary: `Sửa người dùng ${u.fullName}`, before: shape(before), after: shape(u) });
      return shape(u);
    });
  });

  app.post('/api/users/:id/reset-password', { preHandler: requirePermission('settings.edit') }, async req => {
    const id = Number((req.params as { id: string }).id);
    const { newPassword } = z.object({ newPassword: z.string().min(6) }).parse(req.body);
    return db.$transaction(async tx => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw notFound('Người dùng');
      await guardAdminChange(tx, req.user!, target);
      const u = await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: true } });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'User', entityId: id, entityCode: u.username, summary: `Đặt lại mật khẩu ${u.fullName}` });
      return { ok: true };
    });
  });
}
