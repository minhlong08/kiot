import type { Tx } from '../db';
import { conflict } from './errors';
import { nextCode, reserveCode } from '../services/codes';

/** Picks a document code: the typed one (moving the sequence past it) or the next automatic one. */
export async function docCode(tx: Tx, prefix: string, typed: string | undefined, exists: (code: string) => Promise<boolean>) {
  if (typed) {
    if (await exists(typed)) throw conflict('DUPLICATE', `Mã ${typed} đã tồn tại`);
    await reserveCode(tx, prefix, typed);
    return typed;
  }
  for (;;) {
    const code = await nextCode(tx, prefix);
    if (!(await exists(code))) return code;
  }
}

/** Adds code/name/unit of each line's product. */
export async function withProductInfo<L extends { productId: number }>(tx: Tx, lines: L[]) {
  const products = await tx.product.findMany({ where: { id: { in: lines.map(l => l.productId) } }, select: { id: true, code: true, name: true, unit: true } });
  const byId = new Map(products.map(p => [p.id, p]));
  return lines.map(l => ({ ...l, productCode: byId.get(l.productId)?.code ?? '', productName: byId.get(l.productId)?.name ?? '', unit: byId.get(l.productId)?.unit ?? '' }));
}

/** Merges duplicate product lines (a scanner may add the same item twice). */
export function mergeLines<L extends { productId: number }>(lines: L[], qtyKeys: (keyof L)[]): L[] {
  const out = new Map<number, L>();
  for (const l of lines) {
    const cur = out.get(l.productId);
    if (!cur) { out.set(l.productId, { ...l }); continue; }
    for (const k of qtyKeys) (cur as Record<string, unknown>)[k as string] = Number(cur[k]) + Number(l[k]);
  }
  return [...out.values()];
}
