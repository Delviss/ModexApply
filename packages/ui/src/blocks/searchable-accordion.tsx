'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Input } from '../primitives/field.js';
import { ChevronDownIcon, SearchIcon } from '../primitives/icons.js';
import { EmptyState } from './empty-state.js';
import { cn } from '../lib/cn.js';

/**
 * Searchable accordion — re-themed from `@cnippet-dev/v-accordion-11`.
 *
 * Live keyword filter over a long list. Used for the public guide Q&A knowledge
 * base and, in Phase 1, for a programme's requirement list — which is often long
 * enough that a student cannot find the one line that applies to them.
 */

export interface AccordionItem {
  id: string;
  question: ReactNode;
  answer: ReactNode;
  /** Plain text used for filtering; falls back to nothing if omitted. */
  searchText?: string;
}

export interface SearchableAccordionProps {
  items: readonly AccordionItem[];
  label: string;
  searchPlaceholder?: string;
  className?: string;
}

export function SearchableAccordion({
  items,
  label,
  searchPlaceholder = 'Filter by keyword',
  className,
}: SearchableAccordionProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    return items.filter((item) => (item.searchText ?? '').toLowerCase().includes(needle));
  }, [items, query]);

  return (
    <div className={cn(className)}>
      <label className="mx-visually-hidden" htmlFor="mx-accordion-search">
        {searchPlaceholder}
      </label>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <SearchIcon size={16} />
        <Input
          id="mx-accordion-search"
          type="search"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches that keyword"
          description={`No entry mentions “${query}”. Try a broader term, or ask a student guide.`}
        />
      ) : (
        <div className={cn('mx-accordion')} role="region" aria-label={label}>
          {filtered.map((item) => {
            const isOpen = open.has(item.id);
            return (
              <div key={item.id} className="mx-accordion__item">
                <h3 style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="mx-accordion__trigger"
                    aria-expanded={isOpen}
                    aria-controls={`mx-accordion-panel-${item.id}`}
                    onClick={() =>
                      setOpen((previous) => {
                        const next = new Set(previous);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })
                    }
                  >
                    {item.question}
                    <ChevronDownIcon size={16} />
                  </button>
                </h3>
                <div
                  id={`mx-accordion-panel-${item.id}`}
                  className="mx-accordion__panel"
                  hidden={!isOpen}
                >
                  {item.answer}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}