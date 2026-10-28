import { productInputSchema, type ProductInput } from '@pd/shared';
import type { Tx } from '../db';
import type { XlsxColumn } from '../lib/excel';
import { audit } from './audit';
import { saveProduct, searchTextOf, type SaveCtx } from './products';

export const IMPORT_COLUMNS: XlsxColumn[] = [
  { header: 'Loại hàng', key: 'type', width: 12 },
  { header: 'Nhóm hàng', key: 'group', width: 30 },
  { header: 'Mã hàng', key: 'code' },
  { header: 'Mã vạch', key: 'barcode' },
  { header: 'Tên hàng', key: 'name', width: 40 },
  { header: 'Thương hiệu', key: 'brand' },
  { header: 'Giá bán', key: 'price', money: true },
  { header: 'Giá vốn', key: 'cost', money: true },
  { header: 'Tồn kho', key: 'onHand' },
  { header: 'Tồn nhỏ nhất', key: 'minStock' },
  { header: 'Tồn lớn nhất', key: 'maxStock' },
  { header: 'ĐVT', key: 'unit', width: 10 },
  { header: 'Trọng lượng (g)', key: 'weight' },
  { header: 'Được bán trực tiếp', key: 'isDirectSale' },
  { header: 'Mô tả', key: 'description', width: 40 },
];

export const IMPORT_EXAMPLE = {
  type: 'Hàng hóa', group: 'Thời trang Nam>Áo vest', code: 'NA001', barcode: '', name: 'Áo vest nam màu xám', brand: '',
  price: 1_599_000, cost: 690_000, onHand: 10, minStock: 1, maxStock: 100, unit: 'cái', weight: 800, isDirectSale: 'Có', description: '',
};

export type ImportError = { row: number; message: string };
type Parsed = { row: number; input: ProductInput; groupPath: string[]; brand: string };

const TYPE_MAP: Record<string, ProductInput['type']> = { 'hàng hóa': 'goods', 'hang hoa': 'goods', 'dịch vụ': 'service', 'dich vu': 'service' };
const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).trim();
const num = (v: unknown, def = 0) => {
  const s = str(v).replace(/,/g, '');
  return s === '' ? def : Number(s);
};
const yes = (v: unknown) => !['không', 'khong', 'no', '0', 'false'].includes(str(v).toLowerCase());

/** Maps raw sheet rows (keyed by header text) to product inputs, collecting row-level errors. */
export function parseImportRows(raw: Record<string, unknown>[]): { parsed: Parsed[]; errors: ImportError[] } {
  const byHeader = (r: Record<string, unknown>, key: string) => r[IMPORT_COLUMNS.find(c => c.key === key)!.header];
  const errors: ImportError[] = [];
  const parsed: Parsed[] = [];
  const seen = new Map<string, number>();
  raw.forEach((r, i) => {
    const row = i + 2;
    const typeText = str(byHeader(r, 'type')).toLowerCase() || 'hàng hóa';
    const type = TYPE_MAP[typeText];
    if (!type) return errors.push({ row, message: `Loại hàng "${typeText}" không hợp lệ (Hàng hóa / Dịch vụ)` });
    const code = str(byHeader(r, 'code'));
    if (code) {
      if (seen.has(code)) return errors.push({ row, message: `Mã hàng ${code} bị trùng với dòng ${seen.get(code)}` });
      seen.set(code, row);
    }
    const groupPath = str(byHeader(r, 'group')).split('>').map(s => s.trim()).filter(Boolean);
    const candidate = {
      code: code || undefined, barcode: str(byHeader(r, 'barcode')) || undefined, name: str(byHeader(r, 'name')), type,
      groupId: type === 'service' && !groupPath.length ? null : groupPath.length ? -1 : null,
      price: num(byHeader(r, 'price')), cost: num(byHeader(r, 'cost')), onHand: type === 'goods' ? num(byHeader(r, 'onHand')) : undefined,
      minStock: num(byHeader(r, 'minStock')), maxStock: num(byHeader(r, 'maxStock'), 999_999_999), unit: str(byHeader(r, 'unit')),
      weight: num(byHeader(r, 'weight')), isDirectSale: yes(byHeader(r, 'isDirectSale')), description: str(byHeader(r, 'description')),
    };
    const res = productInputSchema.safeParse(candidate);
    if (!res.success) {
      const issue = res.error.issues[0];
      const field = IMPORT_COLUMNS.find(c => c.key === (issue.path[0] === 'groupId' ? 'group' : issue.path[0]))?.header ?? String(issue.path[0] ?? '');
      return errors.push({ row, message: `${field}: ${issue.message}` });
    }
    parsed.push({ row, input: res.data, groupPath, brand: str(byHeader(r, 'brand')) });
  });
  return { parsed, errors };
}

async function resolveGroup(tx: Tx, path: string[]): Promise<number | null> {
  let parentId: number | null = null;
  for (const name of path) {
    const found: { id: number } | null = await tx.productGroup.findFirst({ where: { name, parentId } });
    parentId = found ? found.id : (await tx.productGroup.create({ data: { name, parentId } })).id;
  }
  return parentId;
}

async function resolveBrand(tx: Tx, name: string) {
  if (!name) return null;
  return (await tx.brand.findUnique({ where: { name } }))?.id ?? (await tx.brand.create({ data: { name } })).id;
}

export async function importProducts(tx: Tx, ctx: SaveCtx, raw: Record<string, unknown>[], mode: 'create' | 'upsert', opts: { canCost?: boolean } = {}) {
  const canCost = opts.canCost ?? true;
  const { parsed, errors } = parseImportRows(raw);
  const codes = parsed.map(p => p.input.code).filter((c): c is string => !!c);
  const existing = new Map((await tx.product.findMany({ where: { code: { in: codes } } })).map(p => [p.code, p]));
  if (mode === 'create') {
    for (const p of parsed) if (p.input.code && existing.has(p.input.code)) errors.push({ row: p.row, message: `Mã hàng ${p.input.code} đã tồn tại` });
  }
  if (errors.length) return { created: 0, updated: 0, errors: errors.sort((a, b) => a.row - b.row) };

  let created = 0, updated = 0;
  for (const p of parsed) {
    const groupId = await resolveGroup(tx, p.groupPath);
    const brandId = await resolveBrand(tx, p.brand);
    const current = p.input.code ? existing.get(p.input.code) : undefined;
    if (current) {
      // Upsert only touches the columns the sheet carries; units, images and variants stay as they are.
      const { onHand: _o, units: _u, attributes: _a, variants: _v, comboItems: _c, warranties: _w, images: _i, branchIds: _b, code: _code, ...fields } = p.input;
      await tx.product.update({
        where: { id: current.id },
        data: { name: fields.name, barcode: fields.barcode ?? null, price: fields.price, ...(canCost ? { cost: fields.cost } : {}), minStock: fields.minStock, maxStock: fields.maxStock, unit: fields.unit, weight: fields.weight, isDirectSale: fields.isDirectSale, description: fields.description, groupId, brandId, searchText: searchTextOf(current.code, fields.barcode, fields.name) },
      });
      updated++;
    } else {
      await saveProduct(tx, ctx, { ...p.input, groupId, brandId }, undefined, { canCost });
      created++;
    }
  }
  await audit(tx, ctx, { action: 'import', entity: 'Product', entityId: 'import', summary: `Import hàng hóa: ${created} thêm mới, ${updated} cập nhật` });
  return { created, updated, errors: [] as ImportError[] };
}
