import type { FC } from 'react';
import { DashboardPage } from './DashboardPage';
import { SettingsPage } from './settings/SettingsPage';
import { AuditLogPage } from './settings/AuditLogPage';
import { ProductsPage } from './products/ProductsPage';
import { PriceBooksPage } from './priceBooks/PriceBooksPage';
import { SuppliersPage } from './suppliers/SuppliersPage';
import { PurchaseOrderEditor, ReceiptEditor } from './purchasing/PurchaseEditor';
import { makePurchaseDocsPage } from './purchasing/PurchaseDocsPage';
import { PurchaseReturnEditor } from './purchasing/PurchaseReturnEditor';
import { IncomingInvoicesPage } from './purchasing/IncomingInvoicesPage';
import { ServicePurchasesPage } from './purchasing/ServicePurchasesPage';
import { CustomersPage } from './customers/CustomersPage';
import { CustomerGroupsPage } from './customers/CustomerGroupsPage';
import { PromotionsPage } from './promotions/PromotionsPage';
import { MessagingPage } from './messaging/MessagingPage';
import { InvoicesPage } from './sales/InvoicesPage';
import { ReturnsPage } from './sales/ReturnsPage';
import { CustomerOrdersPage } from './sales/CustomerOrdersPage';
import { CustomerOrderEditor } from './sales/CustomerOrderEditor';
import { makeStockDocListPage } from './stock/StockDocListPage';
import { makeStockDocEditor } from './stock/StockDocEditor';
import { STOCK_DOCS, type StockDocKind } from './stock/configs';

const stockPages = Object.fromEntries(
  (Object.keys(STOCK_DOCS) as StockDocKind[]).flatMap(k => [
    [STOCK_DOCS[k].route, makeStockDocListPage(k)],
    [`${STOCK_DOCS[k].route}/$id`, makeStockDocEditor(k)],
  ]),
);

/**
 * Page registry. Each milestone adds its screens here; any nav path without an entry renders "coming soon".
 * Keys are route paths (TanStack Router syntax, e.g. '/purchase-receipts/$id').
 */
export const PAGES: Record<string, FC> = {
  '/dashboard': DashboardPage,
  '/settings': SettingsPage,
  '/settings/audit-log': AuditLogPage,
  '/products': ProductsPage,
  '/price-books': PriceBooksPage,
  '/suppliers': SuppliersPage,
  '/purchase-receipts': makePurchaseDocsPage('receipt'),
  '/purchase-receipts/$id': ReceiptEditor,
  '/purchase-orders': makePurchaseDocsPage('order'),
  '/purchase-orders/$id': PurchaseOrderEditor,
  '/purchase-returns': makePurchaseDocsPage('return'),
  '/purchase-returns/$id': PurchaseReturnEditor,
  '/incoming-invoices': IncomingInvoicesPage,
  '/service-purchases': ServicePurchasesPage,
  '/customers': CustomersPage,
  '/customer-groups': CustomerGroupsPage,
  '/promotions': PromotionsPage,
  '/messaging': MessagingPage,
  '/invoices': InvoicesPage,
  '/returns': ReturnsPage,
  '/customer-orders': CustomerOrdersPage,
  '/customer-orders/$id': CustomerOrderEditor,
  ...stockPages,
};
