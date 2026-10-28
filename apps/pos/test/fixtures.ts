import { settingsSchema } from '@pd/shared';
import type { Bootstrap, PosCustomer } from '../src/lib/types';
import type { CatalogProduct } from '../src/state/carts';

export const boot = (o: Partial<Bootstrap> = {}): Bootstrap => ({
  settings: settingsSchema.parse({ pos: { bankQr: { bankBin: '970436', accountNumber: '0011001234567', accountName: 'PHUONG DONG' } } }),
  branch: { id: 1, name: 'Chi nhánh trung tâm', address: '', phone: '' },
  funds: [{ id: 1, name: 'Tiền mặt', type: 'cash', accountNumber: '', bankName: '' }, { id: 2, name: 'VCB', type: 'bank', accountNumber: '0011001234567', bankName: 'VCB' }],
  channels: [{ id: 1, code: 'store', name: 'Cửa hàng' }], groups: [{ id: 3, name: 'Thời trang Nam', parentId: null }], users: [{ id: 1, fullName: 'Thu ngân' }],
  priceBooks: [{ id: 2, name: 'Giá VIP', customerGroupIds: [5], allowOutsideItems: true }], promotions: [],
  user: { id: 1, fullName: 'Thu ngân', isAdmin: false, maxDiscountPercent: 10, canEditPrice: false, canSeeCost: false, permissions: ['pos.access'] },
  serverTime: new Date().toISOString(), ...o,
});

export const vest: CatalogProduct = { id: 1, code: 'NA001', barcode: '893', name: 'Áo vest nam xám', searchText: 'na001 893 ao vest nam xam', type: 'goods', groupId: 3, unit: 'cái', price: 1_000_000, loyaltyEnabled: true, points: null, vatRate: null, orderNoteTemplate: '', sellable: true, imageUrl: null, onHand: 5, units: [], bookPrices: { 2: 900_000 } };
export const tie: CatalogProduct = { ...vest, id: 2, code: 'NA010', barcode: '894', name: 'Cà vạt lụa', searchText: 'na010 894 ca vat lua', price: 300_000, bookPrices: {} };
export const vip: PosCustomer = { id: 7, code: 'KH000007', name: 'Chị Mai', phone: '0903111222', groupId: 5, groupName: 'VIP', discountPercent: 5, debt: 0, points: 120 };
