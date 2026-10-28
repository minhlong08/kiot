import { receiptInputSchema, purchaseOrderInputSchema, purchaseReturnInputSchema, supplierInputSchema } from '@pd/shared';
import type { PrismaClient } from '../generated/prisma/client';
import { saveSupplier } from '../services/suppliers';
import { completeReceipt, saveReceipt } from '../services/receipts';
import { confirmPurchaseOrder, savePurchaseOrder } from '../services/purchaseOrders';
import { completePurchaseReturn, savePurchaseReturn } from '../services/purchaseReturns';
import { postPartnerLedger } from '../services/partnerLedger';
import { recordCash } from '../services/cash';

const SUPPLIERS = [
  { name: 'Công ty TNHH May Việt Tiến Phát', phone: '02838123456', group: 'May mặc', taxCode: '0312000001', address: 'Quận Tân Bình, TP. Hồ Chí Minh' },
  { name: 'Xưởng may Hồng Hà', phone: '0912345001', group: 'May mặc', taxCode: '0312000002', address: 'Quận 12, TP. Hồ Chí Minh' },
  { name: 'Công ty CP Da Giày Sài Gòn', phone: '02838654321', group: 'Phụ kiện', taxCode: '0312000003', address: 'Quận 6, TP. Hồ Chí Minh' },
  { name: 'Cơ sở túi ví Minh Châu', phone: '0987000004', group: 'Phụ kiện', taxCode: '', address: 'Thủ Đức, TP. Hồ Chí Minh' },
  { name: 'Công ty TNHH Thời trang Lụa Xanh', phone: '02437000005', group: 'May mặc', taxCode: '0101000005', address: 'Hà Nội' },
];

const DAY = 86400_000;

/** Demo purchasing history over the last 30 days, built through the real services so every ledger agrees. */
export async function seedPurchasing(prisma: PrismaClient, now = new Date()) {
  if (await prisma.supplier.count()) return;
  const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' } });
  const branch = await prisma.branch.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const ctx = { userId: admin.id, branchId: branch.id, ip: '' };
  const at = (daysAgo: number, hour = 9) => new Date(Math.floor(now.getTime() / DAY) * DAY - daysAgo * DAY + (hour - 7) * 3600_000);

  await prisma.$transaction(async tx => {
    const groups = new Map<string, number>();
    for (const g of ['May mặc', 'Phụ kiện']) groups.set(g, (await tx.supplierGroup.create({ data: { name: g } })).id);
    const suppliers = [];
    for (const s of SUPPLIERS) suppliers.push(await saveSupplier(tx, ctx, supplierInputSchema.parse({ ...s, groupId: groups.get(s.group) })));
    const bySupplier = (code: string) => (code.startsWith('NA0') && Number(code.slice(2)) <= 9) || code.startsWith('NU00') ? 0 : 2;

    const goods = await tx.product.findMany({ where: { type: 'goods' }, orderBy: { code: 'asc' } });
    // 20 receipts, two products each, spread from 30 days ago to yesterday.
    const receipts = [];
    for (let i = 0; i < goods.length; i += 2) {
      const n = i / 2;
      const items = goods.slice(i, i + 2);
      const supplier = suppliers[(bySupplier(items[0].code) + n) % suppliers.length];
      const lines = items.map((p, k) => ({ productId: p.id, qty: 8 + ((n + k) % 5) * 3, unitCost: p.cost + ((n % 3) - 1) * 10_000, discount: 0 }));
      const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
      const paid = n === 3 || n === 11 ? Math.round(total / 2 / 1000) * 1000 : n === 17 ? 0 : total;
      const when = at(30 - Math.floor(n * 1.5), 9 + (n % 6));
      const input = receiptInputSchema.parse({ supplierId: supplier.id, lines, paid, at: when.toISOString(), invoiceNo: n % 4 === 0 ? `000${100 + n}` : '' });
      const r = await saveReceipt(tx, ctx, input);
      await completeReceipt(tx, ctx, r.id, when);
      receipts.push(r);
    }

    // One supplier settles part of its debt.
    const indebted = await tx.supplier.findFirst({ where: { debt: { gt: 0 } }, orderBy: { id: 'asc' } });
    if (indebted) {
      const amount = Math.round(indebted.debt / 2 / 1000) * 1000;
      const v = await recordCash(tx, ctx, { kind: 'out', amount, categoryName: 'Chi tiền trả NCC', counterpartyType: 'supplier', counterpartyId: indebted.id, counterpartyName: indebted.name, sourceType: 'supplierPayment', codePrefix: 'TTNCC', note: 'Thanh toán bớt công nợ', at: at(5, 15) });
      await tx.cashVoucher.update({ where: { id: v!.id }, data: { sourceId: v!.id, sourceCode: v!.code } });
      await postPartnerLedger(tx, { partnerType: 'supplier', partnerId: indebted.id, amount: -amount, docType: 'supplierPayment', docId: v!.id, docCode: v!.code, at: at(5, 15) });
    }

    // One return of a defective item from the third receipt.
    const r3 = await tx.purchaseReceipt.findUniqueOrThrow({ where: { id: receipts[2].id }, include: { lines: true } });
    const ret = await savePurchaseReturn(tx, ctx, purchaseReturnInputSchema.parse({ supplierId: r3.supplierId, receiptId: r3.id, lines: [{ productId: r3.lines[0].productId, qty: 1, price: r3.lines[0].unitCost }], note: 'Hàng lỗi đường may' }));
    await completePurchaseReturn(tx, ctx, ret.id);

    // An open purchase order for next week.
    const po = await savePurchaseOrder(tx, ctx, purchaseOrderInputSchema.parse({ supplierId: suppliers[0].id, lines: goods.slice(0, 3).map(p => ({ productId: p.id, qty: 10, unitCost: p.cost })), expectedAt: new Date(now.getTime() + 7 * DAY).toISOString(), note: 'Hàng thu đông' }));
    await confirmPurchaseOrder(tx, ctx, po.id);

    // Incoming invoices: one linked to its receipt, one waiting.
    const s0 = suppliers[0];
    await tx.incomingInvoice.create({ data: { series: '1C26TVT', invoiceNo: '0000100', issuedAt: receipts[0].createdAt, supplierId: s0.id, supplierName: s0.name, supplierTaxCode: s0.taxCode, receiptId: receipts[0].id, subtotal: receipts[0].total, vatAmount: Math.round(receipts[0].total * 0.08), total: Math.round(receipts[0].total * 1.08) } });
    await tx.incomingInvoice.create({ data: { series: '1C26TVT', invoiceNo: '0000137', issuedAt: at(2), supplierId: s0.id, supplierName: s0.name, supplierTaxCode: s0.taxCode, subtotal: 2_400_000, vatAmount: 192_000, total: 2_592_000 } });

    // A delivery service bought on credit.
    const cat = await tx.cashCategory.findUniqueOrThrow({ where: { kind_name: { kind: 'out', name: 'Chi phí dịch vụ' } } });
    const sp = await tx.servicePurchase.create({ data: { code: 'MDV000001', supplierId: suppliers[2].id, branchId: branch.id, serviceName: 'Thuê vận chuyển hàng từ xưởng', categoryId: cat.id, amount: 600_000, paid: 600_000, createdById: admin.id, createdAt: at(10, 14) } });
    await recordCash(tx, ctx, { kind: 'out', amount: 600_000, categoryId: cat.id, counterpartyType: 'supplier', counterpartyId: suppliers[2].id, counterpartyName: suppliers[2].name, sourceType: 'servicePurchase', sourceId: sp.id, sourceCode: sp.code, codePrefix: 'TTMDV', note: sp.serviceName, at: at(10, 14) });
    await tx.documentSequence.upsert({ where: { prefix: 'MDV' }, create: { prefix: 'MDV', next: 2 }, update: { next: 2 } });
  }, { timeout: 120_000 });
}
