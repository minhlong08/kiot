import type { ReactNode } from 'react';

/**
 * Dialog wiring for the products page (form, import, labels, group picker).
 * Filled in by the product form / import / labels tasks; until then these are no-ops.
 */
export function productPageHooks(): {
  create: (type: 'goods' | 'service' | 'combo') => void; edit: (id: number) => void; copy: (id: number) => void;
  openImport: () => void; openGroups: () => void; printLabels: (ids: number[]) => void;
  changeGroup: (ids: number[], apply: (groupId: number) => void) => void; elements: ReactNode;
} {
  const noop = () => undefined;
  return { create: noop, edit: noop, copy: noop, openImport: noop, openGroups: noop, printLabels: noop, changeGroup: noop, elements: null };
}
