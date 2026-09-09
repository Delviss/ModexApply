import { Fragment, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Feature comparison table — re-themed from `@7ovr/comparison-3`.
 *
 * The primary surface for programme compare and offer compare. A highlighted
 * column uses the tinted brand surface, never a full crimson fill: highlighting
 * marks *the option the student selected*, and must never read as an
 * endorsement of a commercial partner.
 */

export interface CompareColumn {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  highlighted?: boolean;
}

export interface CompareRow {
  id: string;
  label: ReactNode;
  /** Cell content by column id. Missing means "not published", not "no". */
  cells: Record<string, ReactNode>;
}

export interface CompareGroup {
  id: string;
  label: string;
  rows: readonly CompareRow[];
}

export interface ComparisonTableProps {
  columns: readonly CompareColumn[];
  groups: readonly CompareGroup[];
  caption: string;
  className?: string;
}

export function ComparisonTable({ columns, groups, caption, className }: ComparisonTableProps) {
  return (
    <div className="mx-table-wrap">
      <table className={cn('mx-compare', className)}>
        <caption className="mx-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="mx-visually-hidden">Feature</span>
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="mx-compare__col"
                data-highlighted={column.highlighted ?? false}
              >
                <div>{column.title}</div>
                {column.subtitle ? (
                  <div className="mx-card__description">{column.subtitle}</div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <tr className="mx-compare__group">
                <td colSpan={columns.length + 1}>{group.label}</td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="mx-compare__feature">
                    {row.label}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className="mx-compare__col"
                      data-highlighted={column.highlighted ?? false}
                    >
                      {/* An absent cell is "not published", which is not the same as "no". */}
                      {row.cells[column.id] ?? <span className="mx-card__description">Not published</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
