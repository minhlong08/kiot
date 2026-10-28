import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { changePasswordSchema, loginSchema } from '@pd/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';
import { audit } from '../services/audit';
import { createSession, SESSION_COOKIE, setSessionCookie, user } from '../plugins/auth';

async function accessibleBranches(app: FastifyInstance, userId: number, isAdmin: boolean) {
  return app.prisma.branch.findMany({
    where: { isActive: true, ...(isAdmin ? {} : { users: { some: { userId } } }) },
    select: { id: true, code: true, name: true },
    orderBy: { id: 'asc' },
  });
}

const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 20;

export async function authRoutes(app: FastifyInstance) {
  // Failed attempts per address in a sliding window: slows guessing and caps audit-log writes.
  const fails = new Map<string, number[]>();
  const failures = (ip: string) => {
    const now = Date.now();
    const recent = (fails.get(ip) ?? []).filter(t => now - t < FAIL_WINDOW_MS);
    if (recent.length) fails.set(ip, recent); else fails.delete(ip);
    return recent.length;
  };
  const failed = (ip: string) => fails.set(ip, [...(fails.get(ip) ?? []), Date.now()]);
  app.post('/api/auth/login', async (req, reply) => {
    const { login, password } = loginSchema.parse(req.body);
    const u = await app.prisma.user.findFirst({
      where: { OR: [{ username: login }, { phone: login }, { email: login }] },
      include: { role: true },
    });
    if (failures(req.ip ?? '') > FAIL_LIMIT) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau ít phút');
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
      failed(req.ip ?? '');
      // Recorded for the dashboard's suspicious-login card. What was typed for an unknown account is never stored
      // (people paste passwords into the login box).
      await audit(app.prisma, { userId: null, branchId: null, ip: req.ip ?? '' }, { action: 'loginFailed', entity: 'User', entityId: u?.id ?? 0, entityCode: u?.username ?? '(không tồn tại)', summary: u ? `Đăng nhập thất bại: ${u.username}` : 'Đăng nhập thất bại: tài khoản không tồn tại' });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu không đúng');
    }
    if (!u.isActive) throw new AppError(401, 'INACTIVE', 'Tài khoản đã ngừng hoạt động');
    const branches = await accessibleBranches(app, u.id, u.role.isAdmin);
    if (!branches.length) throw new AppError(403, 'NO_BRANCH', 'Tài khoản chưa được phân quyền chi nhánh');
    const branchId = branches.find(b => b.id === u.defaultBranchId)?.id ?? branches[0].id;
    const sid = await createSession(app.prisma, u.id, branchId, req);
    await audit(app.prisma, { userId: u.id, branchId, ip: req.ip ?? '' }, {
      action: 'login', entity: 'User', entityId: u.id, entityCode: u.username,
      summary: `${u.fullName} đăng nhập`,
    });
    setSessionCookie(reply, sid);
    return { user: { id: u.id, username: u.username, fullName: u.fullName, mustChangePassword: u.mustChangePassword } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const u = user(req);
    await app.prisma.session.delete({ where: { id: u.sessionId } }).catch(() => undefined);
    await audit(app.prisma, req.auditCtx, { action: 'logout', entity: 'User', entityId: u.id, entityCode: u.username, summary: `${u.fullName} đăng xuất` });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async req => {
    const u = user(req);
    const branches = await accessibleBranches(app, u.id, u.isAdmin);
    return {
      user: {
        id: u.id, username: u.username, fullName: u.fullName, roleName: u.roleName, isAdmin: u.isAdmin,
        branchId: u.branchId, mustChangePassword: u.mustChangePassword, maxDiscountPercent: u.maxDiscountPercent,
      },
      branches,
      permissions: [...u.permissions],
    };
  });

  app.post('/api/auth/change-password', async req => {
    const u = user(req);
    const body = changePasswordSchema.parse(req.body);
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(body.currentPassword, row.passwordHash))) {
      throw new AppError(400, 'WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng');
    }
    await app.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false } });
      await tx.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'User', entityId: u.id, entityCode: u.username, summary: `${u.fullName} đổi mật khẩu` });
    });
    return { ok: true };
  });

  app.post('/api/auth/switch-branch', async req => {
    const u = user(req);
    const { branchId } = z.object({ branchId: z.number().int() }).parse(req.body);
    const branches = await accessibleBranches(app, u.id, u.isAdmin);
    if (!branches.some(b => b.id === branchId)) throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền ở chi nhánh này');
    await app.prisma.session.update({ where: { id: u.sessionId }, data: { branchId } });
    return { ok: true };
  });
}
