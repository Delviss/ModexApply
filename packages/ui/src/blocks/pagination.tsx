import { Button } from '../primitives/button.js';
import { Select } from '../primitives/field.js';
import { cn } from '../lib/cn.js';

/**
 * Table Pagination — re-themed from `@shadcnui-blocks/pagination-14`. The
 * standard footer across every admin table.
 *
 * Cursor-based, matching the API contract (Phase 0 §3.5): there is no page
 * number, because effective-dated catalogue rows shift under a reader and an
 * offset would silently skip or repeat them.
 */
export interface PaginationProps {
  rangeStart: number;
  rangeEnd: number;
  totalCount?: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
}

export function Pagination({
  rangeStart,
  rangeEnd,
  totalCount,
  pageSize,
  pageSizeOptions = [25, 50, 100],
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onPageSizeChange,
  className,
}: PaginationProps) {
  return (
    <div className={cn('mx-pagination', className)}>
      <span aria-live="polite">
        Showing {rangeStart}–{rangeEnd}
        {totalCount !== undefined ? ` of ${totalCount}` : ''}
      </span>
      <div className="mx-pagination__controls">
        <label className="mx-field__hint" htmlFor="mx-page-size">
          Rows per page
        </label>
        <Select
          id="mx-page-size"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          style={{ width: 'auto' }}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={onPrevious} disabled={!hasPrevious}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
