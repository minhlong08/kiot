import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { PrismaClient } from './generated/prisma/client';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { getPrisma } from './db';
import { env } from './env';
import { AppError } from './lib/errors';
import { registerAuth } from './plugins/auth';
import './services/customerOrders';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export type BuildOptions = { logger?: boolean; prisma?: PrismaClient; /** Built SPAs to serve; defaults to the admin and POS dist folders when present. */ web?: { admin?: string; pos?: string } };
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
  await serveWeb(app, opts.web ?? env.web);
  return app;
}

/** Production: admin at /, POS at /sale/, each with an index.html fallback for client-side routes (incl. /shop). */
async function serveWeb(app: FastifyInstance, web: { admin?: string; pos?: string }) {
  const admin = web.admin && fs.existsSync(`${web.admin}/index.html`) ? web.admin : null;
  const pos = web.pos && fs.existsSync(`${web.pos}/index.html`) ? web.pos : null;
  if (pos) await app.register(fastifyStatic, { root: pos, prefix: '/sale/', decorateReply: false, wildcard: false, index: false });
  if (admin) await app.register(fastifyStatic, { root: admin, prefix: '/', wildcard: false, index: false });
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    const html = req.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/files/');
    if (html && pos && (url === '/sale' || url.startsWith('/sale/'))) return reply.type('text/html').send(fs.createReadStream(`${pos}/index.html`));
    if (html && admin && !/\.[a-z0-9]+$/i.test(url)) return reply.type('text/html').send(fs.createReadStream(`${admin}/index.html`));
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });
  });
}
