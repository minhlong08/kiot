import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError, badRequest } from '../lib/errors';
import { env } from '../env';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(env.dataDir, 'uploads');
const MAX_BYTES = 2 * 1024 * 1024;
const NAME = /^[\w-]+\.(png|jpg|webp|svg)$/;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

/** Detects the image type from its bytes; the client's filename and content-type are not trusted. */
export function sniffImage(buf: Buffer): keyof typeof TYPES | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg') && !/<script|on\w+\s*=|javascript:/i.test(buf.toString('utf8'))) return 'svg';
  return null;
}

export async function saveImage(buf: Buffer): Promise<string> {
  const ext = sniffImage(buf);
  if (!ext) throw badRequest('BAD_FILE', 'Chỉ chấp nhận ảnh PNG, JPG, WEBP hoặc SVG');
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/files/${name}`;
}

export async function fileRoutes(app: FastifyInstance) {
  app.post('/api/uploads', async req => {
    const file = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) throw badRequest('NO_FILE', 'Chưa chọn file');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new AppError(413, 'FILE_TOO_LARGE', 'Mỗi ảnh không quá 2 MB');
    }
    if (file.file.truncated) throw new AppError(413, 'FILE_TOO_LARGE', 'Mỗi ảnh không quá 2 MB');
    return { url: await saveImage(buf) };
  });

  const serve = async (name: string, reply: import('fastify').FastifyReply) => {
    if (!NAME.test(name)) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });
    try {
      const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
      return reply
        .header('content-type', TYPES[name.split('.').pop()!])
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
        .header('x-content-type-options', 'nosniff')
        .send(buf);
    } catch {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });
    }
  };
  app.get('/files/:name', async (req, reply) => serve((req.params as { name: string }).name, reply));
  app.get('/api/files/:name', async (req, reply) => serve((req.params as { name: string }).name, reply));
}
