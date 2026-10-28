import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_TEMPLATES, TEMPLATE_SIZES, renderTemplate, templateSample, type TemplateKind } from '@pd/shared';
import { requirePermission } from '../plugins/auth';
import { badRequest } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';

const params = (p: unknown) => {
  const { kind, size } = p as { kind: string; size: string };
  const sizes = TEMPLATE_SIZES[kind as TemplateKind] as readonly string[] | undefined;
  if (!sizes?.includes(size)) throw badRequest('BAD_TEMPLATE', 'Loại mẫu in hoặc khổ giấy không hợp lệ');
  return { kind: kind as TemplateKind, size };
};

/** Active templates: saved overrides, else the built-in defaults. Readable by anyone who prints. */
export async function activeTemplates(db: FastifyInstance['prisma']) {
  const saved = await db.printTemplate.findMany();
  return (Object.keys(TEMPLATE_SIZES) as TemplateKind[]).flatMap(kind => TEMPLATE_SIZES[kind].map(size => {
    const row = saved.find(s => s.kind === kind && s.size === size);
    return { kind, size, body: row?.body ?? DEFAULT_TEMPLATES[kind][size], isDefault: !row, updatedAt: row?.updatedAt ?? null };
  }));
}

export async function printTemplateRoutes(app: FastifyInstance) {
  const db = app.prisma;
  app.get('/api/print-templates', async () => activeTemplates(db));
  app.get('/api/print-templates/preview', async req => {
    const { kind, size } = params(req.query);
    const store = (await getSettings(db)).store;
    const body = (await activeTemplates(db)).find(t => t.kind === kind && t.size === size)!.body;
    const data = templateSample(kind, store);
    return { html: renderTemplate(body, data) };
  });
  app.put('/api/print-templates/:kind/:size', { preHandler: requirePermission('settings.edit') }, async req => {
    const { kind, size } = params(req.params);
    const { body } = z.object({ body: z.string().min(1, 'Mẫu in trống').max(200_000) }).parse(req.body);
    const row = await db.printTemplate.upsert({ where: { kind_size: { kind, size } }, create: { kind, size, body }, update: { body, updatedAt: new Date() } });
    await audit(db, req.auditCtx, { action: 'settings', entity: 'PrintTemplate', entityId: row.id, entityCode: `${kind}/${size}`, summary: `Sửa mẫu in ${kind} khổ ${size}` });
    return { kind, size, body: row.body, isDefault: false, updatedAt: row.updatedAt };
  });
  app.delete('/api/print-templates/:kind/:size', { preHandler: requirePermission('settings.edit') }, async req => {
    const { kind, size } = params(req.params);
    await db.printTemplate.deleteMany({ where: { kind, size } });
    await audit(db, req.auditCtx, { action: 'settings', entity: 'PrintTemplate', entityId: 0, entityCode: `${kind}/${size}`, summary: `Khôi phục mẫu in mặc định ${kind} khổ ${size}` });
    return { ok: true };
  });
}
