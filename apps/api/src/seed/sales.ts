import { invoiceInputSchema } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import type { AuthUser } from '../plugins/auth';
import { createInvoice } from '../services/sales';
import { createReturn, returnInputSchema } from '../services/returns';
import { confirmOrder, orderInputSchema, saveOrder } from '../services/customerOrders';
import { getBranchStock } from '../services/stock';
import { ensureChannels } from '../routes/pos';

const DAY = 86400_000;

/** Deterministic pseudo-random numbers so demo data is the same on every install. */
function rng(seed = 42) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** ~45 demo sales over the last 30 days, built through the real sale/return/order services. */
export async function seedSales(prisma: PrismaClient, now = new Date()) {
  if (await prisma.invoice.count()) return;
  await ensureChannels(prisma);
  const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' }, include: { role: true } });
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const user: AuthUser = { id: admin.id, username: admin.username, fullName: admin.fullName, roleId: admin.roleId, roleName: admin.role.name, isAdmin: true, permissions: new Set(), maxDiscountPercent: 100, branchId: branch.id, mustChangePassword: false, sessionId: 'seed' };
  const ctx = { userId: admin.id, branchId: branch.id, ip: '' };
  const rand = rng();
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const at = (daysAgo: number, hour: number) => new Date(Math.floor(now.getTime() / DAY) * DAY - daysAgo * DAY + (hour - 7) * 3600_000 + Math.floor(rand() * 50) * 60_000);

  const goods = await prisma.product.findMany({ where: { type: 'goods', isActive: true } });
  const firstReceipt = new Map<number, Date>();
  for (const r of await prisma.stockLedger.findMany({ where: { docType: 'receipt' }, orderBy: { createdAt: 'asc' } })) if (!firstReceipt.has(r.productId)) firstReceipt.set(r.productId, r.createdAt);
  const customers = await prisma.customer.findMany({ orderBy: { id: 'asc' } });
  const voucher = await prisma.voucher.findFirst({ where: { status: 'unused' } });
  // Products a line promotion could discount; exact transfer amounts are only used for sales without them.
  const promoTouched = new Set<number>();
  for (const pr of await prisma.promotion.findMany({ where: { isActive: true } })) {
    const c = JSON.parse(pr.config) as { productIds?: number[]; groupIds?: number[]; buyProductIds?: number[]; getProductIds?: number[] };
    for (const id of [...(c.productIds ?? []), ...(c.buyProductIds ?? []), ...(c.getProductIds ?? [])]) promoTouched.add(id);
    for (const g of goods) if (g.groupId && c.groupIds?.includes(g.groupId)) promoTouched.add(g.id);
  }
  const channels = ['store', 'store', 'store', 'facebook', 'zalo', 'phone'];
  const invoices: { id: number; customerId: number | null; day: number }[] = [];
  let n = 0;

  await prisma.$transaction(async tx => {
    for (let day = 29; day >= 1; day--) {
      const count = day % 3 === 0 ? 2 : day % 5 === 0 ? 1 : 2;
      for (let k = 0; k < count; k++) {
        n++;
        const when = at(day, 9 + Math.floor(rand() * 11));
        const available: typeof goods = [];
        for (const g of goods) if ((firstReceipt.get(g.id)?.getTime() ?? Infinity) < when.getTime() && (await getBranchStock(tx, g.id, branch.id)).onHand >= 2) available.push(g);
        if (!available.length) continue;
        const picked = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 2) }, () => pick(available)))];
        const lines = picked.map(p => ({ productId: p.id, qty: rand() < 0.8 ? 1 : 2, price: p.price }));
        const customer = n % 2 === 0 ? customers[(n / 2) % customers.length] : null;
        const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
        const useVoucher = !!voucher && n === 9 && subtotal >= 500_000 && subtotal < 2_000_000;
        const onCredit = !!customer && n % 11 === 0;
        const method = n % 5 === 0 ? 'transfer' : 'cash';
        try {
          // Cash is paid generously and the server computes change; transfers must be exact, so they pay the subtotal
          // (only taken when no invoice-level promotion can apply, i.e. below the first promotion tier).
          const exactTransfer = method === 'transfer' && !onCredit && !useVoucher && subtotal < 2_000_000 && lines.every(l => !promoTouched.has(l.productId));
          const payments = onCredit ? [{ method: 'cash' as const, amount: Math.round(subtotal / 2 / 1000) * 1000 }]
            : exactTransfer ? [{ method: 'transfer' as const, amount: subtotal }] : [{ method: 'cash' as const, amount: 99_000_000 }];
          const input = invoiceInputSchema.parse({ customerId: customer?.id ?? null, channel: pick(channels), lines, voucherCode: useVoucher ? voucher!.code : undefined, payments, createdAtClient: when.toISOString() });
          const inv = await createInvoice(tx, ctx, input, user, { at: when });
          invoices.push({ id: inv.id, customerId: inv.customerId, day });
        } catch { /* skip a sale the demo stock cannot cover */ }
      }
    }

    // Returns: two plain refunds and one exchange, on invoices with customers.
    const withCustomer = invoices.filter(i => i.customerId);
    for (const [i, inv] of withCustomer.slice(0, 3).entries()) {
      const line = await tx.invoiceLine.findFirstOrThrow({ where: { invoiceId: inv.id, isGift: false } });
      const other = goods.find(g => g.id !== line.productId && (firstReceipt.get(g.id)?.getTime() ?? Infinity) < now.getTime());
      const input = returnInputSchema.parse({
        invoiceId: inv.id, lines: [{ invoiceLineId: line.id, qty: 1 }], refundMethod: i === 2 ? 'exchange' : i === 1 ? 'debt' : 'cash', note: i === 2 ? 'Đổi size' : 'Khách không vừa',
        exchange: i === 2 && other ? { lines: [{ productId: other.id, qty: 1, price: other.price }], payments: [{ method: 'cash', amount: 99_000_000 }] } : null,
      });
      await createReturn(tx, ctx, input, user);
    }

    // Customer orders: one confirmed with a deposit, one draft.
    const g1 = goods.find(g => g.code === 'NA022') ?? goods[0];
    const g2 = goods.find(g => g.code === 'NU004') ?? goods[1];
    const o1 = await saveOrder(tx, ctx, orderInputSchema.parse({ customerId: customers[1].id, lines: [{ productId: g1.id, qty: 1, price: g1.price }], deposit: 500_000, note: 'Khách hẹn lấy vest cưới cuối tuần' }));
    await confirmOrder(tx, ctx, o1.id);
    await saveOrder(tx, ctx, orderInputSchema.parse({ customerId: customers[3].id, channel: 'facebook', lines: [{ productId: g2.id, qty: 1, price: g2.price }], note: 'Đặt qua Facebook' }));

    // One closed shift per selling day, with the till counted to the dong (one day 20,000 short).
    const cashFunds = (await tx.cashFund.findMany({ where: { type: 'cash' } })).map(f => f.id);
    for (const day of [...new Set(invoices.map(i => i.day))]) {
      const openedAt = at(day, 8), closedAt = new Date(Math.floor(now.getTime() / DAY) * DAY - day * DAY + 14 * 3600_000);
      const v = await tx.cashVoucher.findMany({ where: { fundId: { in: cashFunds }, status: 'completed', createdAt: { gte: openedAt, lte: closedAt } } });
      const expected = 1_000_000 + v.reduce((s, x) => s + (x.kind === 'in' ? x.amount : -x.amount), 0);
      const shift = await tx.shift.create({ data: { branchId: branch.id, userId: admin.id, openedAt, closedAt, openingCash: 1_000_000, expectedCash: expected, countedCash: day === 7 ? expected - 20_000 : expected, note: day === 7 ? 'Thiếu 20.000 chưa rõ lý do' : '' } });
      await tx.invoice.updateMany({ where: { id: { in: invoices.filter(i => i.day === day).map(i => i.id) } }, data: { shiftId: shift.id } });
    }
  }, { timeout: 300_000 });
}
