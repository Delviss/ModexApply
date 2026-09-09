import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

/**
 * Command palette — re-themed from `@ddoemonn/command-palette`.
 *
 * ⌘K fuzzy search with arrow-key navigation. Kept deliberately simple; the
 * async multi-source upgrade (`@lovesickfromthe6ix/omni-command-palette`) lands
 * with catalogue search in Phase 2, when there is something worth searching
 * across.
 */

export interface PaletteAction {
  id: string;
  label: string;
  group?: string;
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  actions: readonly PaletteAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  className?: string;
}

export function CommandPalette({
  actions,
  open,
  onOpenChange,
  placeholder = 'Search programmes, institutions and actions…',
  className,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return actions.slice(0, 12);
    return actions
      .filter((action) => `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [actions, query]);

  if (!open) return null;

  const runActive = () => {
    const action = results[activeIndex];
    if (action !== undefined) {
      action.run();
      onOpenChange(false);
    }
  };

  return (
    <>
      <div className="mx-palette__backdrop" onClick={() => onOpenChange(false)} />
      <div
        className={cn('mx-palette', className)}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="mx-palette__input"
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-activedescendant={results[activeIndex] ? `mx-palette-${results[activeIndex].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              runActive();
            }
          }}
        />
        <ul className="mx-palette__list" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <li className="mx-palette__group">No action matches “{query}”.</li>
          ) : (
            results.map((action, index) => (
              <li
                key={action.id}
                id={`mx-palette-${action.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className="mx-palette__item"
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  action.run();
                  onOpenChange(false);
                }}
              >
                {action.label}
                {action.group ? <span className="mx-palette__group">{action.group}</span> : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
