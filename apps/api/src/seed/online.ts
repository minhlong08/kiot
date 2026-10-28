import { invoiceInputSchema } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import type { AuthUser } from '../plugins/auth';
import { createInvoice } from '../services/sales';
import { setDeliveryStatus } from '../services/delivery';
import { reconcileCod } from '../services/codReconciliation';
import { saveOrder } from '../services/customerOrders';
import { createEInvoiceDraft, issueEInvoice } from '../services/tax';
import { getBranchStock } from '../services/stock';
import { nextCode } from '../services/codes';
import { normalizeVi } from '@pd/shared';

const DAY = 86400_000;

/** Delivery partners and waybills in every status, online orders awaiting confirmation, and issued e-invoices. */
export async function seedOnline(prisma: PrismaClient, now = new Date()) {
  if (await prisma.deliveryPartner.count()) return;
  const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' }, include: { role: true } });
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const user: AuthUser = { id: admin.id, username: admin.username, fullName: admin.fullName, roleId: admin.roleId, roleName: admin.role.name, isAdmin: true, permissions: new Set(), maxDiscountPercent: 100, branchId: branch.id, mustChangePassword: false, sessionId: 'seed' };
  const ctx = { userId: admin.id, branchId: branch.id, ip: '' };
  const customers = await prisma.customer.findMany({ orderBy: { id: 'asc' } });

  await prisma.$transaction(async tx => {
    const partners = [];
    for (const p of [
      { name: 'Giao Hàng Phố Đông', phone: '0243 555 0101', feeMode: 'flat', flatFee: 25_000, feePerKg: 0 },
      { name: 'Vận Chuyển Bắc Nam', phone: '0283 555 0202', feeMode: 'byWeight', flatFee: 18_000, feePerKg: 6_000 },
    ]) {
      const code = await nextCode(tx, 'DT');
      partners.push(await tx.deliveryPartner.create({ data: { ...p, code, searchText: normalizeVi(`${code} ${p.name} ${p.phone}`) } }));
    }

    // Online catalogue: the first 8 goods with stock.
    const goods = await tx.product.findMany({ where: { type: 'goods', isActive: true, parentId: null }, orderBy: { code: 'asc' } });
    const stocked: typeof goods = [];
    for (const g of goods) if ((await getBranchStock(tx, g.id, branch.id)).onHand >= 3) stocked.push(g);
    await tx.product.updateMany({ where: { id: { in: stocked.slice(0, 8).map(g => g.id) } }, data: { sellOnline: true } });

    // Six delivery sales, 6..1 days ago, walked to different statuses.
    const plan: { partner: number | null; prepaid: number; path: string[] }[] = [
      { partner: 0, prepaid: 0, path: ['picked', 'delivering', 'delivered'] },
      { partner: 0, prepaid: 200_000, path: ['picked', 'delivering', 'delivered'] },
      { partner: 1, prepaid: 0, path: ['delivering', 'delivered'] },
      { partner: 1, prepaid: 0, path: ['delivering'] },
      { partner: 0, prepaid: 100_000, path: ['delivering', 'failed', 'returning', 'returned'] },
      { partner: null, prepaid: 0, path: [] },
    ];
    const deliveredIds: number[] = [];
    for (const [i, d] of plan.entries()) {
      const p = stocked[(i * 3) % stocked.length];
      const c = customers[i % customers.length];
      const partner = d.partner === null ? null : partners[d.partner];
      const fee = partner ? (partner.feeMode === 'flat' ? partner.flatFee : partner.flatFee + partner.feePerKg) : 0;
      const input = invoiceInputSchema.parse({
        customerId: c.id, channel: i % 2 ? 'facebook' : 'zalo', lines: [{ productId: p.id, qty: 1, price: p.price }],
        payments: d.prepaid ? [{ method: 'transfer', amount: d.prepaid }] : [],
        delivery: { receiverName: c.name, receiverPhone: c.phone || '0900000000', address: c.address || '12 Phố Huế', province: c.province || 'TP. Hà Nội', partnerId: partner?.id ?? null, fee, weight: 800 },
      });
      const inv = await createInvoice(tx, ctx, input, user, { at: new Date(now.getTime() - (6 - i) * DAY) });
      if (partner) await tx.invoiceDelivery.update({ where: { invoiceId: inv.id }, data: { feePayer: 'shop' } });
      for (const s of d.path) await setDeliveryStatus(tx, ctx, inv.id, s);
      if (d.path.at(-1) === 'delivered' && d.partner === 0) deliveredIds.push(inv.id);
    }
    // The first partner's two delivered parcels are settled; the second partner's stays open.
    await reconcileCod(tx, ctx, { partnerId: partners[0].id, invoiceIds: deliveredIds, fundId: null, note: 'Đối soát tuần' });

    // Two website orders waiting for confirmation.
    for (const [i, c] of customers.slice(0, 2).entries()) {
      const p = stocked[i];
      const o = await saveOrder(tx, ctx, {
        customerId: c.id, sellerId: null, channel: 'website', discount: 0, deposit: 0, depositFundId: null, expectedAt: null, isDelivery: true, confirm: false,
        note: `Giao đến: ${c.name} - ${c.phone} - ${c.address || 'TP. Hà Nội'}`, lines: [{ productId: p.id, unitId: null, qty: 1, price: p.price, discount: 0 }],
      });
      await tx.customerOrder.update({ where: { id: o.id }, data: { status: 'pending', createdById: 0 } });
    }

    // E-invoices for the five most recent completed counter sales.
    const recent = await tx.invoice.findMany({ where: { status: 'completed', isDelivery: false }, orderBy: { createdAt: 'desc' }, take: 5 });
    for (const inv of recent) {
      const e = await createEInvoiceDraft(tx, ctx, { invoiceId: inv.id });
      await issueEInvoice(tx, ctx, e.id);
    }
  }, { timeout: 60_000 });
}
