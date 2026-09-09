import { decodeCursor, encodeCursor, page, type CursorQuery, type Page } from '@modex/contracts';
import { AppError } from '../errors/app-error.js';

/**
 * Cursor paging over a keyset, applied uniformly to every large collection
 * (Phase 0 §3.5).
 *
 * The cursor carries the sort key of the last row rather than an offset, so an
 * effective-dated catalogue that gains a version mid-scroll neither skips nor
 * repeats a row.
 */
export interface KeysetCursor {
  /** Value of the ordering column on the last row of the previous page. */
  orderValue: string;
  /** Tie-break on the primary key, since ordering columns are rarely unique. */
  id: string;
}

export function parseCursor(cursor: string | undefined): KeysetCursor | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const decoded = decodeCursor(cursor);
    const orderValue = decoded.orderValue;
    const id = decoded.id;
    if (typeof orderValue !== 'string' || typeof id !== 'string') {
      throw new TypeError('cursor missing orderValue or id');
    }
    return { orderValue, id };
  } catch {
    throw new AppError('validation_failed', 'The pagination cursor is malformed.');
  }
}

/**
 * Fetches `limit + 1` rows to learn whether another page exists without a second
 * query, then trims the extra row before it reaches the client.
 */
export function buildPage<T>(
  rows: T[],
  query: CursorQuery,
  keyOf: (row: T) => KeysetCursor,
  totalCount?: number,
): Page<T> {
  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last !== undefined ? encodeCursor({ ...keyOf(last) }) : null;
  return page(data, nextCursor, totalCount);
}

export function takeForPage(limit: number): number {
  return limit + 1;
}
