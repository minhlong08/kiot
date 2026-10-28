import { householdTax, vatBreakdown, type VatRow } from '@pd/shared';
import type { Tx } from '../db';
import { AppError, conflict, notFound } from '../lib/errors';
import { getEInvoiceProvider } from '../adapters/einvoice';
import { audit } from './audit';
import { nextCode } from './codes';
import { getSettings } from './settings';
import type { DocCtx } from './stockDocs';

type TaxLine = { amount: number; vatRate: number };

/** Spreads document-level discounts over lines so line amounts add up exactly to `target`. */
export function allocate(amounts: number[], target: number): number[] {
  const sum = amounts.reduce((s, a) => s + a, 0);
  if (!amounts.length) return [];
  if (sum === 0) return amounts.map((_, i) => (i === 0 ? target : 0));
  let left = target;
  return amounts.map((a, i) => {
    if (i === amounts.length - 1) return left;
    const v = Math.round((a * target) / sum);
    left -= v;
    return v;
  });
}

async function rates(tx: Tx, productIds: number[]) {
  const [products, s] = await Promise.all([tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, vatRate: true } }), getSettings(tx)]);
  return (id: number) => products.find(p => p.id === id)?.vatRate ?? s.tax.defaultVatRate;
}

/** VAT-inclusive revenue lines of invoices (scaled to each invoice total) minus their completed returns. */
export async function taxLines(tx: Tx, invoiceWhere: object, returnWhere: object): Promise<TaxLine[]> {
  const [invoices, returns] = await Promise.all([
    tx.invoice.findMany({ where: invoiceWhere, select: { id: true, total: true, lines: { select: { productId: true, amount: true } } } }),
    tx.saleReturn.findMany({ where: { status: 'completed', ...returnWhere }, select: { total: true, lines: { select: { productId: true, amount: true } } } }),
  ]);
  const rateOf = await rates(tx, [...invoices.flatMap(i => i.lines), ...returns.flatMap(r => r.lines)].map(l => l.productId));
  const out: TaxLine[] = [];
  for (const i of invoices) allocate(i.lines.map(l => l.amount), i.total).forEach((amount, k) => out.push({ amount, vatRate: rateOf(i.lines[k].productId) }));
  for (const r of returns) allocate(r.lines.map(l => l.amount), r.total).forEach((amount, k) => out.push({ amount: -amount, vatRate: rateOf(r.lines[k].productId) }));
  return out;
}

const ACTIVE = ['draft', 'issued'];

export async function createEInvoiceDraft(tx: Tx, ctx: DocCtx, input: { invoiceId: number; buyerName?: string; buyerTaxCode?: string; buyerAddress?: string; buyerEmail?: string }) {
  const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv || inv.branchId !== ctx.branchId) throw notFound('Hóa đơn');
  if (inv.status !== 'completed') throw conflict('INVOICE_NOT_COMPLETED', 'Chỉ xuất hóa đơn điện tử cho hóa đơn đã hoàn thành');
  if (await tx.eInvoice.count({ where: { invoiceId: inv.id, status: { in: ACTIVE } } })) throw conflict('EINVOICE_EXISTS', 'Hóa đơn đã có hóa đơn điện tử');
  const customer = inv.customerId ? await tx.customer.findUnique({ where: { id: inv.customerId } }) : null;
  const rows = vatBreakdown(await taxLines(tx, { id: inv.id }, { invoiceId: inv.id }));
  const total = rows.reduce((s, r) => s + r.gross, 0), vat = rows.reduce((s, r) => s + r.vat, 0);
  const settings = await getSettings(tx);
  const e = await tx.eInvoice.create({
    data: {
      invoiceId: inv.id, branchId: inv.branchId, series: settings.tax.einvoiceSeries, createdById: ctx.userId ?? 0,
      buyerName: input.buyerName || customer?.company || customer?.name || 'Người mua không lấy hóa đơn', buyerTaxCode: input.buyerTaxCode ?? customer?.taxCode ?? '',
      buyerAddress: input.buyerAddress ?? [customer?.address, customer?.province].filter(Boolean).join(', '), buyerEmail: input.buyerEmail ?? customer?.email ?? '',
      total, vatAmount: vat, totalBeforeVat: total - vat, ratesJson: JSON.stringify(rows),
    },
  });
  await audit(tx, ctx, { action: 'create', entity: 'EInvoice', entityId: e.id, entityCode: inv.code, summary: `Lập hóa đơn điện tử nháp cho ${inv.code}` });
  return e;
}

export async function issueEInvoice(tx: Tx, ctx: DocCtx, id: number) {
  const e = await tx.eInvoice.findUnique({ where: { id } });
  if (!e || e.branchId !== ctx.branchId) throw notFound('Hóa đơn điện tử');
  const claimed = await tx.eInvoice.updateMany({ where: { id, status: 'draft' }, data: { status: 'issuing' } });
  if (!claimed.count) throw conflict('NOT_DRAFT', 'Hóa đơn điện tử đã phát hành hoặc đã hủy');
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: e.invoiceId } });
  const seq = Number((await nextCode(tx, `HDDT${e.series}`)).slice(`HDDT${e.series}`.length));
  const provider = getEInvoiceProvider();
  const r = await provider.issue({ series: e.series, buyerName: e.buyerName, buyerTaxCode: e.buyerTaxCode, total: e.total, vatAmount: e.vatAmount, invoiceCode: inv.code }, seq);
  const issued = await tx.eInvoice.update({ where: { id }, data: { status: 'issued', number: r.number, lookupCode: r.lookupCode, provider: provider.name, issuedAt: new Date() } });
  await audit(tx, ctx, { action: 'complete', entity: 'EInvoice', entityId: id, entityCode: `${e.series}-${r.number}`, summary: `Phát hành hóa đơn điện tử ${e.series} số ${r.number} (${inv.code})` });
  return issued;
}

export async function cancelEInvoice(tx: Tx, ctx: DocCtx, id: number, reason: string) {
  const e = await tx.eInvoice.findUnique({ where: { id } });
  if (!e || e.branchId !== ctx.branchId) throw notFound('Hóa đơn điện tử');
  const r = await tx.eInvoice.updateMany({ where: { id, status: 'issued' }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } });
  if (!r.count) throw conflict('NOT_ISSUED', 'Chỉ hủy được hóa đơn đã phát hành; hóa đơn nháp thì xóa');
  await getEInvoiceProvider().cancel({ series: e.series, number: e.number! }, reason);
  await audit(tx, ctx, { action: 'cancel', entity: 'EInvoice', entityId: id, entityCode: `${e.series}-${e.number}`, summary: `Hủy hóa đơn điện tử ${e.series} số ${e.number}: ${reason}` });
  return tx.eInvoice.findUniqueOrThrow({ where: { id } });
}

/** Called before a sale is cancelled: an issued e-invoice must be cancelled first; drafts are dropped. */
export async function assertInvoiceCancellable(tx: Tx, invoiceId: number) {
  if (await tx.eInvoice.count({ where: { invoiceId, status: { in: ['issued', 'issuing'] } } })) throw new AppError(409, 'EINVOICE_ISSUED', 'Hóa đơn đã phát hành hóa đơn điện tử: hãy hủy hóa đơn điện tử trước');
  await tx.eInvoice.updateMany({ where: { invoiceId, status: 'draft' }, data: { status: 'deleted' } });
}

/** autoIssue setting, inside the sale's transaction: only the local draft (no provider call, so the sale can never fail on it). */
export async function autoIssueEInvoice(tx: Tx, ctx: DocCtx, invoiceId: number) {
  if (!(await getSettings(tx)).tax.autoIssue) return;
  await createEInvoiceDraft(tx, ctx, { invoiceId });
}

/**
 * After the sale has committed: issue its auto draft through the provider. Best effort — on failure the
 * draft stays and can be issued by hand from the e-invoice screen.
 */
export async function issueAutoDraft(db: PrismaLike, ctx: DocCtx, invoiceId: number | null | undefined) {
  if (!invoiceId || !(await getSettings(db)).tax.autoIssue) return;
  const draft = await db.eInvoice.findFirst({ where: { invoiceId, status: 'draft' } });
  if (!draft) return;
  try {
    await db.$transaction(tx => issueEInvoice(tx, ctx, draft.id));
  } catch (e) {
    console.warn(`[einvoice] auto-issue failed for invoice ${invoiceId}: ${e instanceof Error ? e.message : e}`);
  }
}
type PrismaLike = Tx & { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

/** Quarter in Vietnam time (UTC+7) as a UTC range. */
export function quarterRange(year: number, quarter: number) {
  const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1) - 7 * 3600_000);
  const to = new Date(Date.UTC(year, quarter * 3, 1) - 7 * 3600_000);
  return { from, to };
}

export async function taxDeclaration(tx: Tx, branchId: number | null, year: number, quarter: number) {
  const { from, to } = quarterRange(year, quarter);
  const branch = branchId ? { branchId } : {};
  const rows: VatRow[] = vatBreakdown(await taxLines(tx, { ...branch, status: 'completed', createdAt: { gte: from, lt: to } }, { ...branch, createdAt: { gte: from, lt: to } }));
  const s = await getSettings(tx);
  const revenue = rows.reduce((t, r) => t + r.gross, 0);
  return {
    year, quarter, from, to, mode: s.tax.mode, rows,
    totals: { gross: revenue, net: rows.reduce((t, r) => t + r.net, 0), vat: rows.reduce((t, r) => t + r.vat, 0) },
    household: { ...householdTax(revenue, s.tax.householdVatRate, s.tax.householdPitRate), vatRate: s.tax.householdVatRate, pitRate: s.tax.householdPitRate },
  };
}
