import type { FC } from 'react';
import { DashboardPage } from './DashboardPage';

/**
 * Page registry. Each milestone adds its screens here; any nav path without an entry renders "coming soon".
 * Keys are route paths (TanStack Router syntax, e.g. '/purchase-receipts/$id').
 */
export const PAGES: Record<string, FC> = {
  '/dashboard': DashboardPage,
};
