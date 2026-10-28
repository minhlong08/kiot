import { Fragment, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { formatVnd } from '@pd/shared';
import { t } from '../../lib/i18n';
import { ColumnChooser, useColumnVisibility } from './ColumnChooser';

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  total?: boolean;
  money?: boolean;
  width?: number;
  hiddenByDefault?: boolean;
};

type Id = string | number;

type Props<T> = {
  tableId: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => Id;
  totals?: Record<string, number>;
  sort?: string;
  onSortChange?: (sort: string | undefined) => void;
  selected?: Id[];
  onSelectedChange?: (ids: Id[]) => void;
  starred?: Id[];
  onToggleStar?: (id: Id) => void;
  renderExpanded?: (row: T) => ReactNode;
  loading?: boolean;
  rowClassName?: (row: T) => string | undefined;
  toolbarSlot?: ReactNode;
};

function cellValue<T>(c: Column<T>, row: T): ReactNode {
  if (c.render) return c.render(row);
  const v = (row as Record<string, unknown>)[c.key];
  if (c.money) return typeof v === 'number' ? formatVnd(v) : '';
  return v === null || v === undefined ? '' : String(v);
}

export function DataTable<T>(p: Props<T>) {
  const [expanded, setExpanded] = useState<Id | null>(null);
  const { visible, toggle } = useColumnVisibility(p.tableId, p.columns);
  const cols = useMemo(() => p.columns.filter(c => visible.has(c.key)), [p.columns, visible]);
  const ids = p.rows.map(p.getRowId);
  const selected = p.selected ?? [];
  const allSelected = ids.length > 0 && ids.every(id => selected.includes(id));
  const hasTotals = cols.some(c => c.total) && p.totals;
  const span = cols.length + (p.onSelectedChange ? 1 : 0) + (p.onToggleStar ? 1 : 0);

  function headerClick(c: Column<T>) {
    if (!c.sortable || !p.onSortChange) return;
    const [field, dir] = (p.sort ?? '').split(':');
    if (field !== c.key) p.onSortChange(`${c.key}:asc`);
    else if (dir === 'asc') p.onSortChange(`${c.key}:desc`);
    else p.onSortChange(undefined);
  }

  const toggleRow = (id: Id) =>
    p.onSelectedChange?.(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div className="relative overflow-x-auto">
      <div className="absolute right-1 top-1 z-10">
        <ColumnChooser columns={p.columns} visible={visible} onToggle={toggle} />
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-[5] bg-brand-50 text-slate-700">
          <tr>
            {p.onSelectedChange && (
              <th className="w-9 px-2 py-2.5">
                <input type="checkbox" aria-label="Chọn tất cả" checked={allSelected}
                  onChange={() => p.onSelectedChange!(allSelected ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])])} />
              </th>
            )}
            {p.onToggleStar && <th className="w-8 px-1" aria-label="Yêu thích"><Star size={14} className="text-slate-400" /></th>}
            {cols.map(c => {
              const [field, dir] = (p.sort ?? '').split(':');
              return (
                <th key={c.key} role="columnheader" style={{ width: c.width }} onClick={() => headerClick(c)}
                  className={clsx('whitespace-nowrap px-3 py-2.5 font-semibold', c.align === 'right' || c.money ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.sortable && 'cursor-pointer select-none hover:text-brand-700')}>
                  {c.header}
                  {field === c.key && (dir === 'asc' ? <ArrowUp size={12} className="ml-1 inline" /> : <ArrowDown size={12} className="ml-1 inline" />)}
                </th>
              );
            })}
          </tr>
          {hasTotals && (
            <tr data-testid="totals-row" className="bg-white font-semibold">
              {p.onSelectedChange && <td />}
              {p.onToggleStar && <td />}
              {cols.map(c => (
                <td key={c.key} className={clsx('px-3 py-2', (c.money || c.align === 'right') && 'num')}>
                  {c.total && p.totals?.[c.key] !== undefined ? formatVnd(p.totals[c.key]) : ''}
                </td>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {p.loading && <tr><td colSpan={span} className="px-3 py-10 text-center text-slate-400">{t('common.loading')}</td></tr>}
          {!p.loading && p.rows.length === 0 && (
            <tr><td colSpan={span} className="px-3 py-14 text-center text-slate-400">{t('common.empty')}</td></tr>
          )}
          {!p.loading && p.rows.map(row => {
            const id = p.getRowId(row);
            const isOpen = expanded === id;
            return (
              <Fragment key={id}>
                <tr onClick={() => p.renderExpanded && setExpanded(isOpen ? null : id)}
                  className={clsx('border-b border-slate-100 bg-white', p.renderExpanded && 'cursor-pointer', isOpen ? 'bg-brand-50/60' : 'hover:bg-slate-50', p.rowClassName?.(row))}>
                  {p.onSelectedChange && (
                    <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Chọn dòng" checked={selected.includes(id)} onChange={() => toggleRow(id)} />
                    </td>
                  )}
                  {p.onToggleStar && (
                    <td className="px-1 text-center" onClick={e => { e.stopPropagation(); p.onToggleStar!(id); }}>
                      <Star size={14} className={p.starred?.includes(id) ? 'fill-accent-500 text-accent-500' : 'text-slate-300'} />
                    </td>
                  )}
                  {cols.map(c => (
                    <td key={c.key} className={clsx('px-3 py-2.5', (c.money || c.align === 'right') && 'num', c.align === 'center' && 'text-center')}>
                      {cellValue(c, row)}
                    </td>
                  ))}
                </tr>
                {isOpen && p.renderExpanded && (
                  <tr className="border-b-2 border-brand-600">
                    <td colSpan={span} className="bg-white p-0">{p.renderExpanded(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
