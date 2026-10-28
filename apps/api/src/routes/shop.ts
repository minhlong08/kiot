import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { customerInputSchema, normalizePhone, normalizeVi } from '@pd/shared';
import type { Prisma, Tx } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { getSettings } from '../services/settings';
import { saveCustomer } from '../services/customers';
import { saveOrder } from '../services/customerOrders';
import { audit } from '../services/audit';
import { isVariantMaster } from '../services/products';

const orderInput = z.object({
  customer: z.object({
    name: z.string().trim().min(1, 'Nhập họ tên').max(120), phone: z.string().trim().min(8, 'Nhập số điện thoại').max(20),
    address: z.string().trim().min(1, 'Nhập địa chỉ').max(300), province: z.string().max(100).default(''), ward: z.string().max(100).default(''), note: z.string().max(500).default(''),
  }),
  lines: z.array(z.object({ productId: z.number().int(), qty: z.number().int().min(1, 'Số lượng phải lớn hơn 0').max(99) })).min(1, 'Giỏ hàng trống').max(30),
  /** Honeypot: hidden in the form, so only bots fill it. */
  website: z.string().max(0, 'Yêu cầu không hợp lệ').default(''),
});

const WINDOW_MS = 60_000;
const LIMIT = 10;

/** Public storefront API: no session, read-only except order placement (rate-limited per address). */
export async function shopRoutes(app: FastifyInstance) {
  const db = app.prisma;
  const hits = new Map<string, number[]>();
  const limited = (ip: string) => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > LIMIT;
  };
  async function shop() {
    const s = await getSettings(db);
    if (!s.online.enabled) throw notFound('Trang');
    const branch = s.online.branchId ? await db.branch.findUnique({ where: { id: s.online.branchId } }) : await db.branch.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
    if (!branch) throw notFound('Trang');
    return { settings: s, branchId: branch.id };
  }
  /** Sellable = active, online, not a variant master; a variant is online when it or its master is. */
  async function sellable(ids: number[]) {
    const rows = await db.product.findMany({ where: { id: { in: ids }, isActive: true } });
    const parents = await db.product.findMany({ where: { id: { in: rows.map(r => r.parentId).filter((x): x is number => !!x) } } });
    return rows.filter(p => !isVariantMaster(p) && (p.sellOnline || !!parents.find(x => x.id === p.parentId)?.sellOnline));
  }
  async function decorate(products: { id: number; parentId: number | null; type: string; attributes: string }[], branchId: number) {
    const ids = products.map(p => p.id);
    const children = await db.product.findMany({ where: { parentId: { in: ids }, isActive: true }, select: { id: true, parentId: true, price: true, variantLabel: true } });
    const allIds = [...ids, ...children.map(c => c.id)];
    const [images, stock] = await Promise.all([
      db.productImage.findMany({ where: { productId: { in: allIds } }, orderBy: { sort: 'asc' } }),
      db.branchStock.findMany({ where: { productId: { in: allIds }, branchId } }),
    ]);
    const avail = (id: number, type: string) => type === 'service' || (stock.find(s => s.productId === id)?.onHand ?? 0) - (stock.find(s => s.productId === id)?.reserved ?? 0) > 0;
    return { children, images, avail };
  }

  app.get('/api/shop/info', async () => {
    const { settings } = await shop();
    return { name: settings.store.name, address: settings.store.address, logoUrl: (settings.store as { logoUrl?: string }).logoUrl ?? '', hotline: settings.online.hotline || settings.store.phone, intro: settings.online.intro };
  });
  app.get('/api/shop/groups', async () => {
    await shop();
    const used = await db.product.groupBy({ by: ['groupId'], where: { sellOnline: true, isActive: true, parentId: null } });
    return db.productGroup.findMany({ where: { id: { in: used.map(u => u.groupId).filter((x): x is number => !!x) } }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  });
  app.get('/api/shop/products', async req => {
    const { branchId } = await shop();
    const q = z.object({ search: z.string().max(100).default(''), groupId: z.coerce.number().int().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(60).default(24) }).parse(req.query);
    const where: Prisma.ProductWhereInput = { sellOnline: true, isActive: true, parentId: null, ...(q.groupId ? { groupId: q.groupId } : {}), ...(q.search.trim() ? { searchText: { contains: normalizeVi(q.search) } } : {}) };
    const [rows, total] = await Promise.all([db.product.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), db.product.count({ where })]);
    const { children, images, avail } = await decorate(rows, branchId);
    return {
      total,
      items: rows.map(p => {
        const kids = children.filter(c => c.parentId === p.id);
        const prices = kids.length ? kids.map(k => k.price) : [p.price];
        return { id: p.id, name: p.name, price: Math.min(...prices), maxPrice: Math.max(...prices), imageUrl: images.find(i => i.productId === p.id)?.url ?? images.find(i => kids.some(k => k.id === i.productId))?.url ?? null, inStock: kids.length ? kids.some(k => avail(k.id, p.type)) : avail(p.id, p.type) };
      }),
    };
  });
  app.get('/api/shop/products/:id', async req => {
    const { branchId } = await shop();
    const id = Number((req.params as { id: string }).id);
    const p = await db.product.findFirst({ where: { id, sellOnline: true, isActive: true, parentId: null } });
    if (!p) throw notFound('Sản phẩm');
    const { children, images, avail } = await decorate([p], branchId);
    return {
      id: p.id, name: p.name, price: p.price, description: p.description, unit: p.unit, images: images.filter(i => i.productId === p.id).map(i => i.url),
      inStock: avail(p.id, p.type),
      variants: children.map(c => ({ id: c.id, label: c.variantLabel, price: c.price, inStock: avail(c.id, p.type), imageUrl: images.find(i => i.productId === c.id)?.url ?? null })),
    };
  });
  app.post('/api/shop/orders', async (req: FastifyRequest) => {
    if (limited(req.ip)) throw new AppError(429, 'TOO_MANY_REQUESTS', 'Bạn đặt hàng quá nhanh, vui lòng thử lại sau ít phút');
    const { branchId } = await shop();
    const b = orderInput.parse(req.body);
    const products = await sellable(b.lines.map(l => l.productId));
    if (products.length !== new Set(b.lines.map(l => l.productId)).size) throw badRequest('NOT_FOR_SALE', 'Có sản phẩm không còn bán trực tuyến');
    const ctx = { userId: 0, branchId, ip: req.ip };
    const order = await db.$transaction(async (tx: Tx) => {
      const phone = normalizePhone(b.customer.phone);
      const existing = await tx.customer.findFirst({ where: { OR: [{ phone }, { phone2: phone }] } });
      const customer = existing ?? await saveCustomer(tx, ctx, customerInputSchema.parse({ name: b.customer.name, phone, address: b.customer.address, province: b.customer.province, ward: b.customer.ward, note: 'Khách đặt hàng qua website' }));
      const o = await saveOrder(tx, ctx, {
        customerId: customer.id, sellerId: null, channel: 'website', discount: 0, deposit: 0, depositFundId: null, expectedAt: null, isDelivery: true, confirm: false,
        note: [`Giao đến: ${b.customer.name} - ${phone} - ${[b.customer.address, b.customer.ward, b.customer.province].filter(Boolean).join(', ')}`, b.customer.note].filter(Boolean).join('\n'),
        lines: b.lines.map(l => ({ productId: l.productId, unitId: null, qty: l.qty, price: products.find(p => p.id === l.productId)!.price, discount: 0 })),
      });
      await tx.customerOrder.update({ where: { id: o.id }, data: { status: 'pending' } });
      await audit(tx, ctx, { action: 'create', entity: 'CustomerOrder', entityId: o.id, entityCode: o.code, summary: `Đơn đặt hàng từ website ${o.code}` });
      return o;
    });
    return { code: order.code, total: order.total };
  });
}
