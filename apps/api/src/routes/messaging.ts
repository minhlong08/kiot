import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatVnd } from '@pd/shared';
import { requirePermission, user } from '../plugins/auth';
import { parseList } from '../lib/list';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { getSettings } from '../services/settings';
import { getMessagingAdapter } from '../adapters/messaging';
import { customerWhere } from './customers';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);

export function renderTemplate(body: string, c: { code: string; name: string; points: number; debt: number }, extra: { storeName: string }) {
  return body.replaceAll('{TenKhachHang}', c.name).replaceAll('{MaKhachHang}', c.code).replaceAll('{DiemHienTai}', String(c.points))
    .replaceAll('{CongNo}', formatVnd(c.debt)).replaceAll('{TenCuaHang}', extra.storeName);
}

export async function messagingRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const tplInput = z.object({ name: z.string().trim().min(1).max(120), channel: z.enum(['sms', 'zalo', 'email']).default('sms'), body: z.string().trim().min(1).max(1000) });

  app.get('/api/message-templates', { preHandler: requirePermission('customers.view') }, async () => db.messageTemplate.findMany({ orderBy: { id: 'asc' } }));
  app.post('/api/message-templates', { preHandler: requirePermission('customers.edit') }, async req => db.messageTemplate.create({ data: tplInput.parse(req.body) }));
  app.put('/api/message-templates/:id', { preHandler: requirePermission('customers.edit') }, async req => db.messageTemplate.update({ where: { id: idOf(req) }, data: tplInput.parse(req.body) }));
  app.delete('/api/message-templates/:id', { preHandler: requirePermission('customers.edit') }, async req => { await db.messageTemplate.delete({ where: { id: idOf(req) } }); return { ok: true }; });

  const sendInput = z.object({
    templateId: z.number().int().optional(), body: z.string().max(1000).optional(), channel: z.enum(['sms', 'zalo', 'email']).default('sms'),
    customerIds: z.array(z.number().int()).max(5000).optional(), filter: z.record(z.string(), z.unknown()).optional(), dryRun: z.boolean().default(false),
  });
  app.post('/api/messages/send', { preHandler: requirePermission('customers.message') }, async req => {
    const b = sendInput.parse(req.body);
    const tpl = b.templateId ? await db.messageTemplate.findUnique({ where: { id: b.templateId } }) : null;
    if (b.templateId && !tpl) throw notFound('Mẫu tin nhắn');
    const body = tpl?.body ?? b.body;
    if (!body) throw badRequest('NO_BODY', 'Nhập nội dung tin nhắn');
    if (!b.customerIds && !b.filter) throw badRequest('NO_RECIPIENTS', 'Chọn khách hàng nhận tin');
    const customers = await db.customer.findMany({ where: { ...(b.customerIds ? { id: { in: b.customerIds } } : customerWhere(b.filter!)), isActive: true }, take: 5000 });
    if (b.dryRun) return { recipients: customers.filter(c => (b.channel === 'email' ? c.email : c.phone)).length, skipped: customers.filter(c => !(b.channel === 'email' ? c.email : c.phone)).length };
    const storeName = (await getSettings(db)).store.name;
    const adapter = getMessagingAdapter(b.channel);
    let sent = 0, failed = 0, skipped = 0;
    for (const c of customers) {
      const to = b.channel === 'email' ? c.email : c.phone;
      if (!to) { skipped++; continue; }
      const text = renderTemplate(body, c, { storeName });
      const r = await adapter.send(to, text).catch((e: Error) => ({ ok: false, error: e.message }));
      await db.messageLog.create({ data: { customerId: c.id, phone: to, channel: b.channel, body: text, status: r.ok ? 'sent' : 'failed', provider: adapter.name, error: r.error ?? '', createdById: user(req).id } });
      if (r.ok) sent++; else failed++;
    }
    await audit(db, req.auditCtx, { action: 'create', entity: 'MessageLog', entityId: 'batch', summary: `Gửi tin ${b.channel}: ${sent} thành công, ${failed} lỗi, ${skipped} bỏ qua` });
    return { sent, failed, skipped, provider: adapter.name };
  });

  app.get('/api/messages', { preHandler: requirePermission('customers.view') }, async req => {
    const q = parseList(req.query);
    const [rows, total] = await Promise.all([db.messageLog.findMany({ orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.messageLog.count()]);
    const customers = await db.customer.findMany({ where: { id: { in: rows.map(r => r.customerId ?? 0) } }, select: { id: true, code: true, name: true } });
    return { items: rows.map(r => ({ ...r, customerName: customers.find(c => c.id === r.customerId)?.name ?? '' })), total };
  });
}
