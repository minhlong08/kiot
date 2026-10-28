import { beforeEach, expect, test } from 'vitest';
import { deleteDB } from 'idb';
import { resetDbForTests } from '../src/lib/sync';
import { addProduct, loadCarts, newCart, saveCarts, setQty, type CatalogProduct } from '../src/state/carts';

beforeEach(async () => { await resetDbForTests(); await deleteDB('pd-pos'); });

const product: CatalogProduct = { id: 1, code: 'NA001', barcode: '893', name: 'Áo vest', searchText: 'na001 ao vest', type: 'goods', groupId: 3, unit: 'cái', price: 1_000_000, loyaltyEnabled: true, points: null, vatRate: null, orderNoteTemplate: '', sellable: true, imageUrl: null, onHand: 5, units: [{ id: 7, name: 'hộp', conversion: 6, code: 'NA001-H', barcode: '894', price: 5_500_000 }], bookPrices: { 2: 900_000 } };

test('adding the same product twice increments; units are separate lines; price book price applies', () => {
  let c = newCart(1);
  c = addProduct(c, product, null, null);
  c = addProduct(c, product, null, null);
  c = addProduct(c, product, 7, null);
  expect(c.lines.map(l => [l.unitId, l.qty, l.price])).toEqual([[null, 2, 1_000_000], [7, 1, 5_500_000]]);
  expect(addProduct(newCart(2), product, null, 2).lines[0].price).toBe(900_000);
  expect(setQty(c, c.lines[0].key, 0).lines).toHaveLength(1);
});

test('carts persist per tab', async () => {
  const c = addProduct(newCart(1), product, null, null);
  await saveCarts({ carts: [c, newCart(2)], activeId: c.id });
  await resetDbForTests();
  const loaded = await loadCarts();
  expect(loaded?.carts).toHaveLength(2);
  expect(loaded?.carts[0].lines[0].productId).toBe(1);
});
