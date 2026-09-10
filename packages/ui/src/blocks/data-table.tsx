'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../primitives/button.js';
import { Input } from '../primitives/field.js';
import { ArrowUpDownIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from '../primitives/icons.js';
import { EmptyState } from './empty-state.js';
import { cn } from '../lib/cn.js';

/**
 * Data table — re-themed from `@7ovr/team-members-data-table`, with the
 * bulk-action toolbar from `@felipemenezes098/table-row-selection` folded in.
 *
 * The primary table for application queues, guide rosters and catalogue admin.
 * Sorting and filtering are in-memory here because the server owns real paging
 * (cursor-based); this component renders one page at a time and never pretends
 * to know the full set.
 */

export interface Column<Row> {
  id: string;
  header: ReactNode;
  /** Value used for sorting and search. */
  value: (row: Row) => string | number;
  render?: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Hidden by default but offered in the column-visibility menu. */
  defaultHidden?: boolean;
}

export interface BulkAction<Row> {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'destructive';
  onRun: (rows: Row[]) => void;
}

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowId: (row: Row) => string;
  caption: string;
  searchPlaceholder?: string;
  bulkActions?: readonly BulkAction<Row>[];
  onRowClick?: (row: Row) => void;
  /** Rendered when there are no rows at all — must explain *why*. */
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowId,
  caption,
  searchPlaceholder = 'Search',
  bulkActions = [],
  onRowClick,
  empty,
  footer,
  className,
}: DataTableProps<Row>) {
  // `useId` rather than a constant: two of these on one page -- which compare
  // and the dashboard both do -- would otherwise emit duplicate DOM ids and
  // break every label association on the second one.
  const controlId = useId();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ columnId: string; direction: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)),
  );

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.has(column.id)),
    [columns, hidden],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [...rows];
    return rows.filter((row) =>
      columns.some((column) => String(column.value(row)).toLowerCase().includes(needle)),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (sort === null) return filtered;
    const column = columns.find((c) => c.id === sort.columnId);
    if (column === undefined) return filtered;
    const multiplier = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * multiplier;
      return String(left).localeCompare(String(right)) * multiplier;
    });
  }, [filtered, sort, columns]);

  const selectedRows = sorted.filter((row) => selected.has(rowId(row)));
  const allVisibleSelected = sorted.length > 0 && selectedRows.length === sorted.length;

  const toggleAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(sorted.map(rowId)));
  };

  const toggleRow = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleColumn = (id: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={cn('mx-table-wrap', className)}>
      <div className="mx-table-toolbar">
        <label className="mx-visually-hidden" htmlFor={controlId}>
          {searchPlaceholder}
        </label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 1 280px' }}>
          <SearchIcon size={16} />
          <Input
            id={controlId}
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </span>

        {selectedRows.length > 0 ? (
          <>
            <span className="mx-table-toolbar__count" aria-live="polite">
              {selectedRows.length} selected
            </span>
            {bulkActions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.variant ?? 'secondary'}
                onClick={() => {
                  action.onRun(selectedRows);
                  setSelected(new Set());
                }}
              >
                {action.label}
              </Button>
            ))}
          </>
        ) : null}

        <span className="mx-table-toolbar__spacer" />

        <details>
          <summary className="mx-button" data-variant="secondary" data-size="sm">
            Columns
          </summary>
          <div className="mx-card" data-elevation="2" style={{ position: 'absolute', zIndex: 2, padding: 12 }}>
            {columns.map((column) => (
              <label key={column.id} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={!hidden.has(column.id)}
                  onChange={() => toggleColumn(column.id)}
                />
                <span className="mx-field__hint">{column.header}</span>
              </label>
            ))}
          </div>
        </details>
      </div>

      {sorted.length === 0 ? (
        (empty ?? (
          <EmptyState
            title="Nothing matches this view"
            description={
              query.trim() === ''
                ? 'There are no records here yet.'
                : `No record matches “${query}”. Clear the search to see everything in this view.`
            }
          >
            {query.trim() === '' ? null : (
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                Clear search
              </Button>
            )}
          </EmptyState>
        ))
      ) : (
        <table className="mx-table">
          <caption className="mx-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {bulkActions.length > 0 ? (
                <th scope="col" style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label={allVisibleSelected ? 'Deselect all rows' : 'Select all rows'}
                  />
                </th>
              ) : null}
              {visibleColumns.map((column) => {
                const active = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {column.sortable === false ? (
                      column.header
                    ) : (
                      <button
                        type="button"
                        className="mx-table__sort-button"
                        onClick={() =>
                          setSort((previous) =>
                            previous?.columnId === column.id
                              ? { columnId: column.id, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
                              : { columnId: column.id, direction: 'asc' },
                          )
                        }
                      >
                        {column.header}
                        {active ? (
                          sort.direction === 'asc' ? (
                            <ChevronUpIcon size={14} />
                          ) : (
                            <ChevronDownIcon size={14} />
                          )
                        ) : (
                          <ArrowUpDownIcon size={12} />
                        )}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const id = rowId(row);
              return (
                <tr
                  key={id}
                  data-selected={selected.has(id)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {bulkActions.length > 0 ? (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleRow(id)}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  ) : null}
                  {visibleColumns.map((column) => (
                    <td key={column.id}>{column.render ? column.render(row) : column.value(row)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {footer}
    </div>
  );
}