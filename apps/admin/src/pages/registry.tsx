import type { FC } from 'react';
import { DashboardPage } from './DashboardPage';
import { SettingsPage } from './settings/SettingsPage';
import { AuditLogPage } from './settings/AuditLogPage';

/**
 * Page registry. Each milestone adds its screens here; any nav path without an entry renders "coming soon".
 * Keys are route paths (TanStack Router syntax, e.g. '/purchase-receipts/$id').
 */
export const PAGES: Record<string, FC> = {
  '/dashboard': DashboardPage,
  '/settings': SettingsPage,
  '/settings/audit-log': AuditLogPage,
};
