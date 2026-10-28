import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { PrismaClient } from './generated/prisma/client';
import { getPrisma } from './db';
import { AppError } from './lib/errors';
import { registerAuth } from './plugins/auth';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export type BuildOptions = { logger?: boolean; prisma?: PrismaClient };
export type RoutePlugin = (app: FastifyInstance) => Promise<void> | void;

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  app.decorate('prisma', opts.prisma ?? getPrisma());
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  registerAuth(app);
  app.get('/api/health', async () => ({ ok: true }));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: first ? `${first.path.join('.')}: ${first.message}` : 'Dữ liệu không hợp lệ', issues: err.issues },
      });
    }
    const e = err as { code?: string; statusCode?: number; message: string };
    if (e.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Mã đã tồn tại' } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } });
  });

  const { routes } = await import('./routes/index');
  for (const mod of routes) await app.register(async scoped => mod(scoped));
  return app;
}
