import { normalizeVi, type ProductInput } from '@pd/shared';
import type { Tx } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { audit, type AuditCtx } from './audit';
import { nextCode, reserveCode } from './codes';
import { getSettings } from './settings';
import { moveStock } from './stock';

export const searchTextOf = (code: string, barcode: string | null | undefined, name: string) => normalizeVi(`${code} ${barcode ?? ''} ${name}`);

/** Next free auto code for a prefix (skips codes typed by hand or imported). */
async function freeCode(tx: Tx, prefix: string, exists: (code: string) => Promise<boolean>) {
  for (;;) {
    const code = await nextCode(tx, prefix);
    if (!(await exists(code))) return code;
  }
}

const productCodeTaken = (tx: Tx) => async (code: string) =>
  !!(await tx.product.findUnique({ where: { code } })) || !!(await tx.productUnit.findUnique({ where: { code } }));

export type SaveCtx = AuditCtx & { branchId: number };

type Common = Omit<ProductInput, 'code' | 'barcode' | 'onHand' | 'units' | 'attributes' | 'variants' | 'comboItems' | 'warranties' | 'images' | 'branchIds'>;

function commonData(input: ProductInput): Common {
  const { code: _c, barcode: _b, onHand: _o, units: _u, attributes: _a, variants: _v, comboItems: _ci, warranties: _w, images: _i, branchIds: _bi, ...rest } = input;
  return rest;
}

async function writeOpening(tx: Tx, ctx: SaveCtx, productId: number, code: string, qty: number | undefined, cost: number) {
  if (!qty) return;
  await moveStock(tx, { productId, branchId: ctx.branchId, qty, unitCost: cost, docType: 'opening', docId: productId, docCode: code, note: 'Tồn kho ban đầu' }, { allowNegative: true });
}

export async function saveProduct(tx: Tx, ctx: SaveCtx, input: ProductInput, id?: number) {
  const settings = await getSettings(tx);
  const prefix = settings.orders.codePrefixes.product;
  const before = id ? await tx.product.findUnique({ where: { id } }) : null;
  if (id && !before) throw notFound('Hàng hóa');
  if (before?.parentId) throw badRequest('IS_VARIANT', 'Hãy sửa hàng hóa gốc để cập nhật hàng cùng loại');

  if (input.type === 'combo') {
    const items = await tx.product.findMany({ where: { id: { in: input.comboItems.map(i => i.itemId) } } });
    if (items.length !== input.comboItems.length) throw badRequest('INVALID_COMBO', 'Hàng thành phần không tồn tại');
    if (items.some(i => i.type === 'combo' || i.id === id)) throw badRequest('INVALID_COMBO', 'Hàng thành phần không thể là combo');
  }

  let code = input.code ?? before?.code;
  if (!code) code = await freeCode(tx, prefix, productCodeTaken(tx));
  else if (code !== before?.code) await reserveCode(tx, prefix, code);

  const hasVariants = input.type === 'goods' && input.variants.length > 0;
  const data = {
    ...commonData(input),
    code,
    barcode: input.barcode ?? null,
    searchText: searchTextOf(code, input.barcode, input.name),
    attributes: JSON.stringify(hasVariants ? input.attributes : []),
  };
  const product = id ? await tx.product.update({ where: { id }, data }) : await tx.product.create({ data });

  // Units (views of the base product: own code/barcode/price, stock in base units)
  const keepUnitIds = input.units.map(u => u.id).filter((v): v is number => !!v);
  await tx.productUnit.deleteMany({ where: { productId: product.id, id: { notIn: keepUnitIds } } });
  for (const u of input.units) {
    const unitCode = u.code ?? (u.id ? undefined : await freeCode(tx, prefix, productCodeTaken(tx)));
    const unitData = { name: u.name, conversion: u.conversion, barcode: u.barcode ?? null, price: u.price, isDirectSale: u.isDirectSale, ...(unitCode ? { code: unitCode } : {}) };
    if (u.id) await tx.productUnit.update({ where: { id: u.id }, data: unitData });
    else await tx.productUnit.create({ data: { ...unitData, code: unitCode!, productId: product.id } });
  }

  await tx.productImage.deleteMany({ where: { productId: product.id } });
  if (input.images.length) await tx.productImage.createMany({ data: input.images.map((url, sort) => ({ productId: product.id, url, sort })) });
  await tx.productWarranty.deleteMany({ where: { productId: product.id } });
  if (input.warranties.length) await tx.productWarranty.createMany({ data: input.warranties.map(w => ({ ...w, productId: product.id })) });
  await tx.comboItem.deleteMany({ where: { comboId: product.id } });
  if (input.type === 'combo') await tx.comboItem.createMany({ data: input.comboItems.map(i => ({ comboId: product.id, itemId: i.itemId, qty: i.qty })) });
  await tx.productBranch.deleteMany({ where: { productId: product.id } });
  if (!input.allBranches) await tx.productBranch.createMany({ data: input.branchIds.map(branchId => ({ productId: product.id, branchId })) });

  if (hasVariants) await saveVariants(tx, ctx, product.id, code, input);
  else if (!id && input.type === 'goods') await writeOpening(tx, ctx, product.id, code, input.onHand, input.cost);

  await audit(tx, ctx, {
    action: id ? 'update' : 'create', entity: 'Product', entityId: product.id, entityCode: code,
    summary: `${id ? 'Cập nhật' : 'Thêm mới'} hàng hóa ${code} - ${input.name}`, before: before ?? undefined, after: product,
  });
  return product;
}

async function saveVariants(tx: Tx, ctx: SaveCtx, masterId: number, masterCode: string, input: ProductInput) {
  const existing = await tx.product.findMany({ where: { parentId: masterId } });
  const keep = new Set<number>();
  let n = existing.length;
  for (const v of input.variants) {
    const label = v.values.join(' - ');
    const attrs = JSON.stringify(input.attributes.map((a, i) => ({ name: a.name, value: v.values[i] ?? '' })));
    const name = `${input.name} - ${label}`;
    const common = { ...commonData(input), name, price: v.price, cost: v.cost || input.cost, parentId: masterId, variantLabel: label, attributes: attrs, barcode: v.barcode ?? null, isActive: true };
    const current = v.id ? existing.find(e => e.id === v.id) : existing.find(e => e.variantLabel === label);
    if (current) {
      const code = v.code ?? current.code;
      await tx.product.update({ where: { id: current.id }, data: { ...common, code, searchText: searchTextOf(code, v.barcode, name) } });
      keep.add(current.id);
    } else {
      let code = v.code;
      while (!code) {
        n += 1;
        const candidate = `${masterCode}-${n}`;
        if (!(await productCodeTaken(tx)(candidate))) code = candidate;
      }
      const child = await tx.product.create({ data: { ...common, code, searchText: searchTextOf(code, v.barcode, name) } });
      keep.add(child.id);
      await writeOpening(tx, ctx, child.id, code, v.onHand, common.cost);
    }
  }
  const removed = existing.filter(e => !keep.has(e.id)).map(e => e.id);
  if (removed.length) await tx.product.updateMany({ where: { id: { in: removed } }, data: { isActive: false } });
}

/** Days of cover from the last 30 days of sales; null when nothing sold or nothing left. */
export async function expectedOutDates(tx: Tx, rows: { id: number; onHand: number }[], branchId: number, now = new Date()) {
  const ids = rows.filter(r => r.onHand > 0).map(r => r.id);
  const out = new Map<number, Date | null>();
  if (!ids.length) return out;
  const since = new Date(now.getTime() - 30 * 86400_000);
  const sold = await tx.stockLedger.groupBy({
    by: ['productId'], _sum: { qtyChange: true },
    where: { productId: { in: ids }, branchId, docType: 'invoice', createdAt: { gte: since } },
  });
  for (const s of sold) {
    const perDay = -(s._sum.qtyChange ?? 0) / 30;
    const row = rows.find(r => r.id === s.productId)!;
    out.set(s.productId, perDay > 0 ? new Date(now.getTime() + (row.onHand / perDay) * 86400_000) : null);
  }
  return out;
}

export async function deleteProduct(tx: Tx, ctx: AuditCtx, id: number) {
  const p = await tx.product.findUnique({ where: { id } });
  if (!p) throw notFound('Hàng hóa');
  const children = await tx.product.findMany({ where: { parentId: id }, select: { id: true } });
  const ids = [id, ...children.map(c => c.id)];
  const [history, inCombos] = await Promise.all([
    tx.stockLedger.count({ where: { productId: { in: ids } } }),
    tx.comboItem.count({ where: { itemId: { in: ids } } }),
  ]);
  if (history || inCombos) {
    await tx.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    await audit(tx, ctx, { action: 'update', entity: 'Product', entityId: id, entityCode: p.code, summary: `Ngừng kinh doanh ${p.code} (đã có giao dịch, không thể xóa)` });
    return { deactivated: true as const };
  }
  for (const pid of ids) {
    await tx.productUnit.deleteMany({ where: { productId: pid } });
    await tx.productImage.deleteMany({ where: { productId: pid } });
    await tx.productWarranty.deleteMany({ where: { productId: pid } });
    await tx.comboItem.deleteMany({ where: { comboId: pid } });
    await tx.productBranch.deleteMany({ where: { productId: pid } });
    await tx.branchStock.deleteMany({ where: { productId: pid } });
    await tx.priceBookItem.deleteMany({ where: { productId: pid } });
  }
  await tx.product.deleteMany({ where: { id: { in: children.map(c => c.id) } } });
  await tx.product.delete({ where: { id } });
  await audit(tx, ctx, { action: 'delete', entity: 'Product', entityId: id, entityCode: p.code, summary: `Xóa hàng hóa ${p.code} - ${p.name}`, before: p });
  return { deleted: true as const };
}

export function assertExists<T>(v: T | null, what = 'Hàng hóa'): T {
  if (!v) throw new AppError(404, 'NOT_FOUND', `${what} không tồn tại`);
  return v;
}
