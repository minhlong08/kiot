import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { evaluatePromotions, formatDateTime, moneySchema } from '@pd/shared';
import type { Prisma } from '../db';
import { requirePermission, user } from '../plugins/auth';
import { listParam, parseList } from '../lib/list';
import { sendXlsx } from '../lib/excel';
import { badRequest, notFound } from '../lib/errors';
import { docCode } from '../lib/docs';
import { audit } from '../services/audit';
import { PROMO_CONFIG, activePromotions, checkVoucher, newVoucherCode, type PromoType } from '../services/promotions';

const idOf = (req: FastifyRequest) => Number((req.params as { id: string }).id);
const dt = z.string().datetime({ offset: true }).nullable().optional();
const scope = {
  isActive: z.boolean().default(true), startAt: dt, endAt: dt,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  hours: z.array(z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)])).default([]),
  branchIds: z.array(z.number().int()).default([]), customerGroupIds: z.array(z.number().int()).default([]),
  combinable: z.boolean().default(false), note: z.string().max(1000).default(''),
};
const promoInput = z.object({ code: z.string().trim().max(30).optional().transform(v => v || undefined), name: z.string().trim().min(1, 'Nhập tên chương trình').max(200), type: z.enum(['invoiceDiscount', 'productDiscount', 'buyXGetY', 'giftItem']), config: z.record(z.string(), z.unknown()), ...scope });

function toData(b: z.infer<typeof promoInput>) {
  const parsed = PROMO_CONFIG[b.type as PromoType].safeParse(b.config);
  if (!parsed.success) throw badRequest('VALIDATION', parsed.error.issues[0].message, parsed.error.issues);
  return {
    name: b.name, type: b.type, isActive: b.isActive, combinable: b.combinable, note: b.note,
    startAt: b.startAt ? new Date(b.startAt) : null, endAt: b.endAt ? new Date(b.endAt) : null,
    daysOfWeek: JSON.stringify(b.daysOfWeek), hours: JSON.stringify(b.hours), branchIds: JSON.stringify(b.branchIds),
    customerGroupIds: JSON.stringify(b.customerGroupIds), config: JSON.stringify(parsed.data),
  };
}
const shape = <T extends { daysOfWeek: string; hours: string; branchIds: string; customerGroupIds: string; config: string; startAt: Date | null; endAt: Date | null; isActive: boolean }>(r: T, now = new Date()) => ({
  ...r, daysOfWeek: JSON.parse(r.daysOfWeek), hours: JSON.parse(r.hours), branchIds: JSON.parse(r.branchIds), customerGroupIds: JSON.parse(r.customerGroupIds), config: JSON.parse(r.config),
  state: !r.isActive ? 'inactive' : r.startAt && r.startAt > now ? 'upcoming' : r.endAt && r.endAt < now ? 'ended' : 'running',
});

export async function promotionRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const groupOf = async (customerId?: number) => (customerId ? (await db.customer.findUnique({ where: { id: customerId } }))?.groupId ?? null : null);

  app.get('/api/promotions', { preHandler: requirePermission('promotions.view') }, async req => {
    const q = parseList(req.query);
    const types = listParam((req.query as { types?: string }).types);
    const states = listParam((req.query as { state?: string }).state);
    const rows = await db.promotion.findMany({ where: { ...(types ? { type: { in: types } } : {}), ...(q.search ? { OR: [{ name: { contains: q.search } }, { code: { contains: q.search.toUpperCase() } }] } : {}) }, orderBy: { id: 'desc' } });
    const shaped = rows.map(r => shape(r)).filter(r => !states || states.includes(r.state));
    return { items: shaped.slice(q.skip, q.skip + q.take), total: shaped.length };
  });

  app.get('/api/promotions/active', async req => {
    const customerId = Number((req.query as { customerId?: string }).customerId) || undefined;
    return activePromotions(db, { branchId: user(req).branchId, customerGroupId: await groupOf(customerId) });
  });

  const evalInput = z.object({ customerId: z.number().int().nullable().optional(), lines: z.array(z.object({ key: z.string(), productId: z.number().int(), qty: z.number().int().min(1), price: moneySchema })) });
  app.post('/api/promotions/evaluate', async req => {
    const b = evalInput.parse(req.body);
    const groupId = await groupOf(b.customerId ?? undefined);
    const products = await db.product.findMany({ where: { id: { in: b.lines.map(l => l.productId) } }, select: { id: true, groupId: true } });
    const promos = await activePromotions(db, { branchId: user(req).branchId, customerGroupId: groupId });
    return evaluatePromotions(b.lines.map(l => ({ ...l, groupId: products.find(p => p.id === l.productId)?.groupId ?? null })), promos, { at: new Date(), branchId: user(req).branchId, customerGroupId: groupId });
  });

  app.get('/api/promotions/:id', { preHandler: requirePermission('promotions.view') }, async req => {
    const r = await db.promotion.findUnique({ where: { id: idOf(req) } });
    if (!r) throw notFound('Chương trình khuyến mại');
    return shape(r);
  });
  app.post('/api/promotions', { preHandler: requirePermission('promotions.create') }, async req => {
    const b = promoInput.parse(req.body);
    return db.$transaction(async tx => {
      const code = await docCode(tx, 'KM', b.code, async c => !!(await tx.promotion.findUnique({ where: { code: c } })));
      const r = await tx.promotion.create({ data: { ...toData(b), code } });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'Promotion', entityId: r.id, entityCode: code, summary: `Tạo khuyến mại ${code} - ${r.name}` });
      return shape(r);
    });
  });
  app.put('/api/promotions/:id', { preHandler: requirePermission('promotions.edit') }, async req => {
    const b = promoInput.parse(req.body);
    return db.$transaction(async tx => {
      const before = await tx.promotion.findUnique({ where: { id: idOf(req) } });
      if (!before) throw notFound('Chương trình khuyến mại');
      const r = await tx.promotion.update({ where: { id: before.id }, data: toData(b) });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'Promotion', entityId: r.id, entityCode: r.code, summary: `Sửa khuyến mại ${r.code}`, before, after: r });
      return shape(r);
    });
  });
  app.delete('/api/promotions/:id', { preHandler: requirePermission('promotions.delete') }, async req =>
    db.$transaction(async tx => {
      const r = await tx.promotion.delete({ where: { id: idOf(req) } });
      await audit(tx, req.auditCtx, { action: 'delete', entity: 'Promotion', entityId: r.id, entityCode: r.code, summary: `Xóa khuyến mại ${r.code}`, before: r });
      return { ok: true };
    }));

  // ── vouchers
  const campaignInput = z.object({
    code: z.string().trim().max(30).optional().transform(v => v || undefined), name: z.string().trim().min(1).max(200),
    value: z.number().int().min(1), unit: z.enum(['%', 'VND']), maxDiscount: moneySchema.nullable().optional(), minOrder: moneySchema.default(0),
    startAt: dt, endAt: dt, multiUse: z.boolean().default(false), combinable: z.boolean().default(false), isActive: z.boolean().default(true),
  }).refine(c => c.unit === 'VND' || c.value <= 100, { message: 'Phần trăm tối đa 100', path: ['value'] });
  const campaignData = (b: z.infer<typeof campaignInput>) => ({ ...b, code: undefined, maxDiscount: b.maxDiscount ?? null, startAt: b.startAt ? new Date(b.startAt) : null, endAt: b.endAt ? new Date(b.endAt) : null });

  app.get('/api/voucher-campaigns', { preHandler: requirePermission('promotions.view') }, async () => {
    const [rows, counts] = await Promise.all([db.voucherCampaign.findMany({ orderBy: { id: 'desc' } }), db.voucher.groupBy({ by: ['campaignId', 'status'], _count: { _all: true } })]);
    return rows.map(r => ({ ...r, total: counts.filter(c => c.campaignId === r.id).reduce((s, c) => s + c._count._all, 0), used: counts.find(c => c.campaignId === r.id && c.status === 'used')?._count._all ?? 0 }));
  });
  app.post('/api/voucher-campaigns', { preHandler: requirePermission('promotions.create') }, async req => {
    const b = campaignInput.parse(req.body);
    return db.$transaction(async tx => {
      const code = await docCode(tx, 'VC', b.code, async c => !!(await tx.voucherCampaign.findUnique({ where: { code: c } })));
      const r = await tx.voucherCampaign.create({ data: { ...campaignData(b), code } });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'VoucherCampaign', entityId: r.id, entityCode: code, summary: `Tạo đợt voucher ${r.name}` });
      return r;
    });
  });
  app.put('/api/voucher-campaigns/:id', { preHandler: requirePermission('promotions.edit') }, async req => {
    const b = campaignInput.parse(req.body);
    return db.$transaction(async tx => {
      const r = await tx.voucherCampaign.update({ where: { id: idOf(req) }, data: campaignData(b) });
      await audit(tx, req.auditCtx, { action: 'update', entity: 'VoucherCampaign', entityId: r.id, entityCode: r.code, summary: `Sửa đợt voucher ${r.name}` });
      return r;
    });
  });
  app.post('/api/voucher-campaigns/:id/generate', { preHandler: requirePermission('promotions.create', 'promotions.edit') }, async req => {
    const { count } = z.object({ count: z.number().int().min(1).max(1000) }).parse(req.body);
    return db.$transaction(async tx => {
      const c = await tx.voucherCampaign.findUnique({ where: { id: idOf(req) } });
      if (!c) throw notFound('Đợt voucher');
      const codes: string[] = [];
      while (codes.length < count) {
        const code = newVoucherCode();
        if (codes.includes(code) || (await tx.voucher.findUnique({ where: { code } }))) continue;
        codes.push(code);
      }
      await tx.voucher.createMany({ data: codes.map(code => ({ campaignId: c.id, code })) });
      await audit(tx, req.auditCtx, { action: 'create', entity: 'VoucherCampaign', entityId: c.id, entityCode: c.code, summary: `Phát hành ${count} voucher ${c.name}` });
      return { codes };
    });
  });
  app.get('/api/voucher-campaigns/:id/vouchers', { preHandler: requirePermission('promotions.view') }, async req => {
    const q = parseList(req.query);
    const where: Prisma.VoucherWhereInput = { campaignId: idOf(req), ...(q.search ? { code: { contains: q.search.toUpperCase() } } : {}) };
    const [items, total] = await Promise.all([db.voucher.findMany({ where, orderBy: { id: 'asc' }, skip: q.skip, take: q.take }), db.voucher.count({ where })]);
    return { items, total };
  });
  app.get('/api/voucher-campaigns/:id/export', { preHandler: requirePermission('promotions.view') }, async (req, reply) => {
    const rows = await db.voucher.findMany({ where: { campaignId: idOf(req) }, orderBy: { id: 'asc' } });
    return sendXlsx(reply, 'voucher.xlsx', [{ header: 'Mã voucher', key: 'code' }, { header: 'Trạng thái', key: 'status' }, { header: 'Ngày dùng', key: 'used' }], rows.map(r => ({ ...r, used: r.usedAt ? formatDateTime(r.usedAt) : '' })));
  });
  app.get('/api/vouchers/check', async req => {
    const q = z.object({ code: z.string().min(1), total: z.coerce.number().int().min(0) }).parse(req.query);
    const r = await checkVoucher(db, q.code, q.total);
    return r.valid ? { valid: true, discount: r.discount, campaign: r.campaign } : r;
  });
}
