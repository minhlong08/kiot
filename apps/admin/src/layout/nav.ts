/** `perm` omitted: visible to every signed-in user (the page limits what they see). */
export type NavItem = { labelKey: string; to: string; perm?: string };
export type NavColumn = { titleKey: string; items: NavItem[] };
export type NavSection = { key: string; labelKey: string; to?: string; perm?: string; columns?: NavColumn[] };

export const NAV: NavSection[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', to: '/dashboard', perm: 'dashboard.view' },
  {
    key: 'products', labelKey: 'nav.products', columns: [
      { titleKey: 'nav.g.goods', items: [
        { labelKey: 'nav.productList', to: '/products', perm: 'products.view' },
        { labelKey: 'nav.priceBooks', to: '/price-books', perm: 'priceBooks.view' },
      ] },
      { titleKey: 'nav.g.warehouse', items: [
        { labelKey: 'nav.stockTakes', to: '/stock-takes', perm: 'stockTakes.view' },
        { labelKey: 'nav.transfers', to: '/transfers', perm: 'transfers.view' },
        { labelKey: 'nav.internalUse', to: '/internal-uses', perm: 'internalUse.view' },
        { labelKey: 'nav.writeOffs', to: '/write-offs', perm: 'writeOffs.view' },
      ] },
    ],
  },
  {
    key: 'purchasing', labelKey: 'nav.purchasing', columns: [
      { titleKey: 'nav.g.suppliers', items: [
        { labelKey: 'nav.suppliers', to: '/suppliers', perm: 'suppliers.view' },
        { labelKey: 'nav.incomingInvoices', to: '/incoming-invoices', perm: 'incomingInvoices.view' },
      ] },
      { titleKey: 'nav.g.buying', items: [
        { labelKey: 'nav.purchaseOrders', to: '/purchase-orders', perm: 'purchaseOrders.view' },
        { labelKey: 'nav.purchaseReceipts', to: '/purchase-receipts', perm: 'purchaseReceipts.view' },
        { labelKey: 'nav.purchaseReturns', to: '/purchase-returns', perm: 'purchaseReturns.view' },
      ] },
      { titleKey: 'nav.g.services', items: [
        { labelKey: 'nav.servicePurchases', to: '/service-purchases', perm: 'servicePurchases.view' },
      ] },
    ],
  },
  {
    key: 'orders', labelKey: 'nav.orders', columns: [
      { titleKey: 'nav.g.sales', items: [
        { labelKey: 'nav.customerOrders', to: '/customer-orders', perm: 'customerOrders.view' },
        { labelKey: 'nav.invoices', to: '/invoices', perm: 'invoices.view' },
        { labelKey: 'nav.returns', to: '/returns', perm: 'returns.view' },
      ] },
      { titleKey: 'nav.g.delivery', items: [
        { labelKey: 'nav.waybills', to: '/waybills', perm: 'deliveries.view' },
        { labelKey: 'nav.deliveries', to: '/deliveries', perm: 'deliveries.view' },
        { labelKey: 'nav.deliveryPartners', to: '/delivery-partners', perm: 'deliveries.view' },
      ] },
    ],
  },
  {
    key: 'customers', labelKey: 'nav.customers', columns: [
      { titleKey: 'nav.g.customers', items: [
        { labelKey: 'nav.customerList', to: '/customers', perm: 'customers.view' },
        { labelKey: 'nav.customerGroups', to: '/customer-groups', perm: 'customers.view' },
      ] },
      { titleKey: 'nav.g.marketing', items: [
        { labelKey: 'nav.promotions', to: '/promotions', perm: 'promotions.view' },
        { labelKey: 'nav.messaging', to: '/messaging', perm: 'customers.view' },
      ] },
    ],
  },
  {
    key: 'staff', labelKey: 'nav.staff', columns: [
      { titleKey: 'nav.g.staff', items: [
        { labelKey: 'nav.employees', to: '/employees', perm: 'employees.view' },
        { labelKey: 'nav.workSchedule', to: '/work-schedule', perm: 'employees.view' },
        { labelKey: 'nav.timesheets', to: '/timesheets' },
        { labelKey: 'nav.staffSettings', to: '/staff-settings', perm: 'employees.edit' },
      ] },
      { titleKey: 'nav.g.payroll', items: [
        { labelKey: 'nav.payroll', to: '/payroll', perm: 'payroll.view' },
        { labelKey: 'nav.commissions', to: '/commissions', perm: 'payroll.view' },
      ] },
    ],
  },
  { key: 'cashbook', labelKey: 'nav.cashbook', to: '/cashbook', perm: 'cashbook.view' },
  {
    key: 'reports', labelKey: 'nav.reports', columns: [
      { titleKey: 'nav.g.analysis', items: [
        { labelKey: 'nav.r.business', to: '/analytics/business', perm: 'reports.view' },
        { labelKey: 'nav.r.goods', to: '/analytics/products', perm: 'reports.view' },
        { labelKey: 'nav.r.customers', to: '/analytics/customers', perm: 'reports.view' },
        { labelKey: 'nav.r.efficiency', to: '/analytics/efficiency', perm: 'reports.view' },
      ] },
      { titleKey: 'nav.g.reportList', items: [
        { labelKey: 'nav.r.endOfDay', to: '/reports/end-of-day', perm: 'reports.view' },
        { labelKey: 'nav.r.sales', to: '/reports/sales', perm: 'reports.view' },
        { labelKey: 'nav.r.orders', to: '/reports/orders', perm: 'reports.view' },
        { labelKey: 'nav.r.products', to: '/reports/products', perm: 'reports.view' },
        { labelKey: 'nav.r.customerReport', to: '/reports/customers', perm: 'reports.view' },
        { labelKey: 'nav.r.suppliers', to: '/reports/suppliers', perm: 'reports.view' },
        { labelKey: 'nav.r.staff', to: '/reports/staff', perm: 'reports.view' },
        { labelKey: 'nav.r.channels', to: '/reports/channels', perm: 'reports.view' },
        { labelKey: 'nav.r.finance', to: '/reports/finance', perm: 'reports.view' },
      ] },
    ],
  },
  {
    key: 'online', labelKey: 'nav.online', columns: [
      { titleKey: 'nav.g.online', items: [
        { labelKey: 'nav.channels', to: '/online/channels', perm: 'online.view' },
        { labelKey: 'nav.onlineOrders', to: '/online/orders', perm: 'online.view' },
        { labelKey: 'nav.storefront', to: '/online/storefront', perm: 'online.view' },
      ] },
    ],
  },
  {
    key: 'tax', labelKey: 'nav.tax', columns: [
      { titleKey: 'nav.g.tax', items: [
        { labelKey: 'nav.taxSettings', to: '/tax/settings', perm: 'tax.view' },
        { labelKey: 'nav.eInvoices', to: '/tax/e-invoices', perm: 'tax.view' },
        { labelKey: 'nav.taxDeclaration', to: '/tax/declaration', perm: 'tax.view' },
      ] },
    ],
  },
];

/** Every routable path in the nav, used by the router to register pages. */
export const NAV_PATHS: string[] = NAV.flatMap(s => (s.to ? [s.to] : s.columns!.flatMap(c => c.items.map(i => i.to))));
