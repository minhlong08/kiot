import type { Tx } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { isVariantMaster } from './products';

/** Validates product/unit pairs for purchase documents and returns each line's conversion to base units. */
export async function resolveUnits<L extends { productId: number; unitId?: number | null }>(tx: Tx, lines: L[]): Promise<(L & { conversion: number })[]> {
  const products = await tx.product.findMany({ where: { id: { in: lines.map(l => l.productId) } } });
  const units = await tx.productUnit.findMany({ where: { id: { in: lines.map(l => l.unitId).filter((v): v is number => !!v) } } });
  return lines.map(l => {
    const p = products.find(x => x.id === l.productId);
    if (!p) throw notFound('Hàng hóa');
    if (p.type !== 'goods' || isVariantMaster(p)) throw badRequest('NOT_STOCKED', `${p.code} không phải hàng hóa có tồn kho`);
    if (!l.unitId) return { ...l, unitId: null, conversion: 1 };
    const u = units.find(x => x.id === l.unitId);
    if (!u || u.productId !== p.id) throw badRequest('INVALID_UNIT', `Đơn vị tính không thuộc hàng ${p.code}`);
    return { ...l, conversion: u.conversion };
  });
}

/** Adds product code/name and the unit name shown on the line. */
export async function linesWithInfo<L extends { productId: number; unitId: number | null }>(tx: Tx, lines: L[]) {
  const [products, units] = await Promise.all([
    tx.product.findMany({ where: { id: { in: lines.map(l => l.productId) } }, select: { id: true, code: true, name: true, unit: true } }),
    tx.productUnit.findMany({ where: { id: { in: lines.map(l => l.unitId).filter((v): v is number => !!v) } } }),
  ]);
  return lines.map(l => {
    const p = products.find(x => x.id === l.productId);
    const u = l.unitId ? units.find(x => x.id === l.unitId) : null;
    return { ...l, productCode: u?.code ?? p?.code ?? '', productName: p?.name ?? '', unit: u?.name ?? p?.unit ?? '' };
  });
}
