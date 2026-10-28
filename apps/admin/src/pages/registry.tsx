import type { FC } from 'react';
import { DashboardPage } from './DashboardPage';
import { SettingsPage } from './settings/SettingsPage';
import { AuditLogPage } from './settings/AuditLogPage';
import { ProductsPage } from './products/ProductsPage';
import { PriceBooksPage } from './priceBooks/PriceBooksPage';
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
  ...stockPages,
};
