import type { ProductType } from '@pd/shared';

export type UnitDraft = { id?: number; name: string; conversion: number; code: string; barcode: string; price: number; isDirectSale: boolean };
export type AttrDraft = { name: string; valuesText: string };
export type VariantDraft = { id?: number; values: string[]; code: string; barcode: string; price: number; cost: number; onHand: number };
export type ComboDraft = { itemId: number; qty: number; code: string; name: string; price: number; cost: number };
export type WarrantyDraft = { kind: 'warranty' | 'maintenance'; name: string; duration: number; durationUnit: 'day' | 'month' | 'year' };

export type ProductDraft = {
  code: string; barcode: string; name: string; type: ProductType; groupId: number | null; brandId: number | null; locationId: number | null;
  price: number; cost: number; onHand: number; minStock: number; maxStock: number; weight: number; weightUnit: 'g' | 'kg'; unit: string;
  description: string; note: string; orderNoteTemplate: string; vatRate: number | null; loyaltyEnabled: boolean; points: number | null;
  isDirectSale: boolean; sellOnline: boolean; allBranches: boolean; branchIds: number[]; images: string[];
  units: UnitDraft[]; attributes: AttrDraft[]; variants: VariantDraft[]; comboItems: ComboDraft[]; warranties: WarrantyDraft[];
};

export const emptyDraft = (type: ProductType): ProductDraft => ({
  code: '', barcode: '', name: '', type, groupId: null, brandId: null, locationId: null, price: 0, cost: 0, onHand: 0, minStock: 0, maxStock: 999_999_999,
  weight: 0, weightUnit: 'g', unit: '', description: '', note: '', orderNoteTemplate: '', vatRate: null, loyaltyEnabled: true, points: null,
  isDirectSale: true, sellOnline: false, allBranches: true, branchIds: [], images: [], units: [], attributes: [], variants: [], comboItems: [], warranties: [],
});

export const splitValues = (text: string) => [...new Set(text.split(',').map(s => s.trim()).filter(Boolean))];

/** Draft → API payload (ProductInput shape). */
export function toPayload(d: ProductDraft, isEdit: boolean) {
  const attributes = d.attributes.map(a => ({ name: a.name.trim(), values: splitValues(a.valuesText) })).filter(a => a.name && a.values.length);
  return {
    code: d.code.trim() || undefined, barcode: d.barcode.trim() || undefined, name: d.name, type: d.type,
    groupId: d.groupId, brandId: d.brandId, locationId: d.locationId, price: d.price, cost: d.cost,
    onHand: !isEdit && d.type === 'goods' ? d.onHand : undefined, minStock: d.minStock, maxStock: d.maxStock,
    weight: d.weightUnit === 'kg' ? Math.round(d.weight * 1000) : Math.round(d.weight), unit: d.unit, description: d.description, note: d.note,
    orderNoteTemplate: d.orderNoteTemplate, vatRate: d.vatRate, loyaltyEnabled: d.loyaltyEnabled, points: d.points, isDirectSale: d.isDirectSale,
    sellOnline: d.sellOnline, allBranches: d.allBranches, branchIds: d.branchIds, images: d.images,
    units: d.units.map(u => ({ id: u.id, name: u.name, conversion: u.conversion, code: u.code || undefined, barcode: u.barcode || undefined, price: u.price, isDirectSale: u.isDirectSale })),
    attributes: d.type === 'goods' ? attributes : [],
    variants: d.type === 'goods' && attributes.length ? d.variants.map(v => ({ id: v.id, values: v.values, code: v.code || undefined, barcode: v.barcode || undefined, price: v.price, cost: v.cost, onHand: v.id ? undefined : v.onHand })) : [],
    comboItems: d.type === 'combo' ? d.comboItems.map(c => ({ itemId: c.itemId, qty: c.qty })) : [],
    warranties: d.warranties,
  };
}
