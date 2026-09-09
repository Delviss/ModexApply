import type { ReactNode } from 'react';
import { InboxIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * Empty — re-themed from `@cnippet-dev/cnippet-empty`, composable and
 * dependency-free.
 *
 * This is the carrier for the platform's "explain why there are no results"
 * rule. An empty catalogue because a partnership was revoked, an empty result
 * set because a filter is too narrow, and an empty result set because every
 * matching programme has a stale tuition figure are three different situations,
 * and a student deserves to be told which one they are looking at.
 */

export interface EmptyStateProps {
  title: ReactNode;
  /** Why there is nothing here. Required — a bare "No results" is not enough. */
  description: ReactNode;
  media?: ReactNode;
  /** What the reader can do next. */
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, media, children, className }: EmptyStateProps) {
  return (
    <div className={cn('mx-empty', className)} role="status">
      <span className="mx-empty__media">{media ?? <InboxIcon size={22} />}</span>
      <h3 className="mx-empty__title">{title}</h3>
      <p className="mx-empty__description">{description}</p>
      {children ? <div className="mx-empty__content">{children}</div> : null}
    </div>
  );
}
