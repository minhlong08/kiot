import { z } from 'zod';

const codePrefixes = z.object({
  invoice: z.string().default('HD'),
  return: z.string().default('TH'),
  customerOrder: z.string().default('DH'),
  purchaseReceipt: z.string().default('PN'),
  purchaseReturn: z.string().default('THN'),
  purchaseOrder: z.string().default('PDN'),
  stockTake: z.string().default('KK'),
  writeOff: z.string().default('XH'),
  internalUse: z.string().default('XDNB'),
  transfer: z.string().default('CH'),
  cashIn: z.string().default('PT'),
  cashOut: z.string().default('PC'),
  servicePurchase: z.string().default('MDV'),
  product: z.string().default('SP'),
  customer: z.string().default('KH'),
  supplier: z.string().default('NCC'),
}).prefault({});

export const settingsSchema = z.object({
  store: z.object({
    name: z.string().default('PhuongDong Fashion'),
    phone: z.string().default(''),
    address: z.string().default(''),
    taxCode: z.string().default(''),
    logoUrl: z.string().default(''),
    notice: z.string().default(''),
  }).prefault({}),
  products: z.object({
    allowNegativeStock: z.boolean().default(false),
    costMethod: z.enum(['average']).default('average'),
  }).prefault({}),
  orders: z.object({
    codePrefixes,
    rounding: z.enum(['none', 'hundred', 'thousand']).default('none'),
    requireCustomer: z.boolean().default(false),
  }).prefault({}),
  customers: z.object({
    loyaltyEnabled: z.boolean().default(true),
    vndPerPoint: z.number().int().min(1).default(10000),
    pointValueVnd: z.number().int().min(0).default(1000),
    debtLimit: z.number().int().min(0).default(0),
  }).prefault({}),
  pos: z.object({
    defaultFundIds: z.object({ cash: z.number().int().nullable().default(null), transfer: z.number().int().nullable().default(null), card: z.number().int().nullable().default(null), ewallet: z.number().int().nullable().default(null) }).prefault({}),
    /** Bank account shown as VietQR for transfers. */
    bankQr: z.object({ bankBin: z.string().default(''), accountNumber: z.string().default(''), accountName: z.string().default('') }).prefault({}),
    receiptTemplate: z.enum(['58', '80', 'A4']).default('80'),
    printAfterPayment: z.boolean().default(true),
  }).prefault({}),
  online: z.object({
    enabled: z.boolean().default(true),
    /** Branch whose stock the storefront shows and whose orders it creates; null = first active branch. */
    branchId: z.number().int().nullable().default(null),
    hotline: z.string().max(30).default(''),
    intro: z.string().max(1000).default(''),
  }).prefault({}),
  tax: z.object({
    mode: z.enum(['household', 'company']).default('household'),
    defaultVatRate: z.number().min(0).max(100).default(8),
    /** Business household: flat VAT and personal income tax as % of revenue (goods distribution: 1% + 0.5%). */
    householdVatRate: z.number().min(0).max(100).default(1),
    householdPitRate: z.number().min(0).max(100).default(0.5),
    einvoiceSeries: z.string().trim().regex(/^[0-9A-Z]{1,10}$/, 'Ký hiệu gồm chữ in hoa và số').default('1C26TPD'),
    /** Create and issue the e-invoice automatically when a sale completes. */
    autoIssue: z.boolean().default(false),
  }).prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;
