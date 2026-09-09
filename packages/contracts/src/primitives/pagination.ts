import { z } from 'zod';

/**
 * Cursor-based pagination on every large collection (Phase 0 §3.5). Offset
 * pagination is not offered: catalogue records are effective-dated and shift
 * under a reader, and offsets silently skip or repeat rows when they do.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export interface Page<T> {
  data: T[];
  pageInfo: {
    nextCursor: string | null;
    hasNextPage: boolean;
    /** Only present where a count is cheap; never blocks the page itself. */
    totalCount?: number;
  };
}

/** Cursors are opaque to clients: base64url of the sort key, not a row offset. */
export function encodeCursor(parts: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, string | number> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('cursor payload is not an object');
    }
    return parsed as Record<string, string | number>;
  } catch {
    throw new TypeError('Malformed pagination cursor.');
  }
}

export function page<T>(data: T[], nextCursor: string | null, totalCount?: number): Page<T> {
  return {
    data,
    pageInfo: {
      nextCursor,
      hasNextPage: nextCursor !== null,
      ...(totalCount === undefined ? {} : { totalCount }),
    },
  };
}
