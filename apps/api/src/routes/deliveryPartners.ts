import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { moneySchema, normalizeVi } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission } from '../plugins/auth';
import { parseList } from '../lib/list';
import { notFound } from '../lib/errors';
import { audit } from '../services/audit';
import { nextCode } from '../services/codes';
import { getCarrierAdapter } from '../adapters/carrier';
import { idOf } from './purchasing';

const partnerInput = z.object({
  name: z.string().trim().min(1, 'Nhập tên đối tác').max(120), phone: z.string().max(20).default(''), email: z.string().max(120).default(''),
  address: z.string().max(300).default(''), note: z.string().max(500).default(''), feeMode: z.enum(['flat', 'byWeight']).default('flat'),
  flatFee: moneySchema.default(0), feePerKg: moneySchema.default(0), isActive: z.boolean().default(true),
});
const searchOf = (p: { code: string; name: string; phone: string }) => normalizeVi(`${p.code} ${p.name} ${p.phone}`);

export async function deliveryPartnerRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const find = async (id: number) => (await db.deliveryPartner.findUnique({ where: { id } })) ?? Promise.reject(notFound('Đối tác giao hàng'));

  app.get('/api/delivery-partners', { preHandler: requirePermission('deliveries.view', 'invoices.create', 'pos.access') }, async req => {
    const q = parseList(req.query);
    const status = (req.query as { status?: string }).status ?? 'active';
    const where: Prisma.DeliveryPartnerWhereInput = { ...(status === 'all' ? {} : { isActive: status === 'active' }), ...(q.searchNorm ? { searchText: { contains: q.searchNorm } } : {}) };
    const [items, total] = await Promise.all([db.deliveryPartner.findMany({ where, orderBy: { name: 'asc' }, skip: q.skip, take: q.take }), db.deliveryPartner.count({ where })]);
    return { items, total };
  });
  app.get('/api/delivery-partners/:id', { preHandler: requirePermission('deliveries.view') }, async req => find(idOf(req)));
  app.get('/api/delivery-partners/:id/ledger', { preHandler: requirePermission('deliveries.view') }, async req => {
    const q = parseList(req.query);
    const where = { partnerType: 'deliveryPartner', partnerId: idOf(req) };
    const [items, total] = await Promise.all([db.partnerLedger.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.take }), db.partnerLedger.count({ where })]);
    return { items, total };
  });
  app.post('/api/delivery-partners/:id/quote', { preHandler: requirePermission('deliveries.view', 'invoices.create', 'pos.access') }, async req => {
    const { weight } = z.object({ weight: z.number().int().min(0).default(0) }).parse(req.body ?? {});
    const p = await find(idOf(req));
    return getCarrierAdapter(p.code).quote(p, { weight });
  });
  app.post('/api/delivery-partners', { preHandler: requirePermission('deliveries.create') }, async req => {
    const data = partnerInput.parse(req.body);
    return db.$transaction(async tx => {
      const code = await nextCode(tx, 'DT');
      const p = await tx.deliveryPartner.create({ data: { ...data, code, searchText: searchOf({ ...data, code }) } });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'DeliveryPartner', entityId: p.id, entityCode: code, summary: `Tạo đối tác giao hàng ${p.name}` });
      return p;
    });
  });
  app.put('/api/delivery-partners/:id', { preHandler: requirePermission('deliveries.edit') }, async req => {
    const data = partnerInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await find(idOf(req));
      const p = await tx.deliveryPartner.update({ where: { id: before.id }, data: { ...data, searchText: searchOf({ ...data, code: before.code }) } });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'DeliveryPartner', entityId: p.id, entityCode: p.code, summary: `Sửa đối tác giao hàng ${p.name}`, before, after: p });
      return p;
    });
  });
  app.delete('/api/delivery-partners/:id', { preHandler: requirePermission('deliveries.delete') }, async req =>
    db.$transaction(async tx => {
      const p = await find(idOf(req));
      const used = (await tx.invoiceDelivery.count({ where: { partnerId: p.id } })) + (await tx.partnerLedger.count({ where: { partnerType: 'deliveryPartner', partnerId: p.id } }));
      if (used) {
        await tx.deliveryPartner.update({ where: { id: p.id }, data: { isActive: false } });
        await audit(tx, req.auditCtx, { action: 'update', entity: 'DeliveryPartner', entityId: p.id, entityCode: p.code, summary: `Ngừng hoạt động đối tác ${p.name}` });
        return { deactivated: true };
      }
      await tx.deliveryPartner.delete({ where: { id: p.id } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'DeliveryPartner', entityId: p.id, entityCode: p.code, summary: `Xóa đối tác giao hàng ${p.name}`, before: p });
      return { deleted: true };
    }));
}
