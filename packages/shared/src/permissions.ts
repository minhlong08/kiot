export const MODULES = [
  { key: 'dashboard', labelKey: 'nav.dashboard' },
  { key: 'products', labelKey: 'nav.products' },
  { key: 'priceBooks', labelKey: 'nav.priceBooks' },
  { key: 'stockTakes', labelKey: 'nav.stockTakes' },
  { key: 'internalUse', labelKey: 'nav.internalUse' },
  { key: 'writeOffs', labelKey: 'nav.writeOffs' },
  { key: 'transfers', labelKey: 'nav.transfers' },
  { key: 'suppliers', labelKey: 'nav.suppliers' },
  { key: 'purchaseOrders', labelKey: 'nav.purchaseOrders' },
  { key: 'purchaseReceipts', labelKey: 'nav.purchaseReceipts' },
  { key: 'purchaseReturns', labelKey: 'nav.purchaseReturns' },
  { key: 'incomingInvoices', labelKey: 'nav.incomingInvoices' },
  { key: 'servicePurchases', labelKey: 'nav.servicePurchases' },
  { key: 'customerOrders', labelKey: 'nav.customerOrders' },
  { key: 'invoices', labelKey: 'nav.invoices' },
  { key: 'returns', labelKey: 'nav.returns' },
  { key: 'deliveries', labelKey: 'nav.deliveries' },
  { key: 'customers', labelKey: 'nav.customers' },
  { key: 'promotions', labelKey: 'nav.promotions' },
  { key: 'employees', labelKey: 'nav.employees' },
  { key: 'payroll', labelKey: 'nav.payroll' },
  { key: 'cashbook', labelKey: 'nav.cashbook' },
  { key: 'reports', labelKey: 'nav.reports' },
  { key: 'online', labelKey: 'nav.online' },
  { key: 'tax', labelKey: 'nav.tax' },
  { key: 'settings', labelKey: 'nav.settings' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const;
export type Action = (typeof ACTIONS)[number];
export const permKey = (m: string, a: string) => `${m}.${a}`;
export const SPECIAL_PERMS = ['cost.view', 'pos.editPrice', 'pos.access', 'customers.adjust', 'customers.message'] as const;
export const ALL_PERMS: string[] = [
  ...MODULES.flatMap(m => ACTIONS.map(a => permKey(m.key, a))),
  ...SPECIAL_PERMS,
];
