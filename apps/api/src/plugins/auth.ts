import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client';
import type { AuditCtx } from '../services/audit';
import { AppError } from '../lib/errors';
import { env } from '../env';

export const SESSION_COOKIE = 'pd_sid';
const SESSION_DAYS = 30;

export type AuthUser = {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  roleName: string;
  isAdmin: boolean;
  permissions: Set<string>;
  maxDiscountPercent: number;
  branchId: number;
  mustChangePassword: boolean;
  sessionId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    auditCtx: AuditCtx;
  }
}

/** Paths reachable without a session. Everything else under /api requires one. */
const PUBLIC = [/^\/api\/auth\/login$/, /^\/api\/health$/, /^\/api\/shop(\/|$)/, /^\/api\/files\//];
/** Paths reachable while a password change is pending. */
const DURING_PASSWORD_CHANGE = /^\/api\/auth\//;

export async function createSession(prisma: PrismaClient, userId: number, branchId: number, req: FastifyRequest) {
  const id = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      id, userId, branchId, ip: req.ip ?? '', userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
    },
  });
  return id;
}

export function setSessionCookie(reply: FastifyReply, id: string) {
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true, sameSite: 'lax', path: '/', secure: env.isProd, maxAge: SESSION_DAYS * 86400,
  });
}

export async function loadUser(prisma: PrismaClient, sessionId: string): Promise<AuthUser | null> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { role: { include: { permissions: true } } } } },
  });
  if (!s || s.expiresAt < new Date() || !s.user.isActive) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  }
  const u = s.user;
  return {
    id: u.id, username: u.username, fullName: u.fullName, roleId: u.roleId, roleName: u.role.name,
    isAdmin: u.role.isAdmin, permissions: new Set(u.role.permissions.map(p => p.key)),
    maxDiscountPercent: u.role.isAdmin ? 100 : u.role.maxDiscountPercent,
    branchId: s.branchId, mustChangePassword: u.mustChangePassword, sessionId: s.id,
  };
}

export function hasPerm(user: AuthUser | null, key: string): boolean {
  return !!user && (user.isAdmin || user.permissions.has(key));
}

/** Route preHandler: requires a permission key (admins bypass). Authentication is enforced globally. */
export function requirePermission(...keys: string[]) {
  return async (req: FastifyRequest) => {
    if (!keys.some(k => hasPerm(req.user, k))) throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');
  };
}

export function user(req: FastifyRequest): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');
  return req.user;
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('auditCtx', null as unknown as AuditCtx);
  app.addHook('onRequest', async req => {
    const sid = req.cookies?.[SESSION_COOKIE];
    req.user = sid ? await loadUser(app.prisma, sid) : null;
    req.auditCtx = { userId: req.user?.id ?? null, branchId: req.user?.branchId ?? null, ip: req.ip ?? '' };
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC.some(r => r.test(path))) return;
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập');
    if (req.user.mustChangePassword && !DURING_PASSWORD_CHANGE.test(path)) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Bạn cần đổi mật khẩu trước khi tiếp tục');
    }
  });
}
