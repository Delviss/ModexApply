'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/button.js';
import { usePrefersReducedMotion } from '../lib/motion.js';

/**
 * A modal sheet with real focus management.
 *
 * The Phase 1 admin drawer was a `role="dialog"` with none of the behaviour the
 * role promises — no focus trap, no Escape, no focus restore. That was
 * survivable on one internal screen. Phase 2 puts a dialog in front of students
 * (the mobile filter rail, the document preview), so the behaviour is built
 * here once rather than half-built three more times.
 *
 * Focus moves in on open, is trapped while open, and returns to whatever opened
 * it on close — the last of those being the part most often missed, and the one
 * a keyboard user notices immediately.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** `side` for the mobile filter rail; `center` for previews and confirmations. */
  variant?: 'side' | 'center';
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  variant = 'center',
  children,
  footer,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (panel === null) return [];
    // Filtered on `hidden`, deliberately not on `offsetParent`. The usual
    // offsetParent trick reports null for anything inside a `position: fixed`
    // ancestor -- which is exactly what this sheet is -- so it would find no
    // focusable elements at all and the trap would silently do nothing.
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    // Remembered before focus moves, so it survives whatever the panel does.
    restoreTo.current = document.activeElement as HTMLElement | null;
    const [first] = focusables();
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusables();
      const first = elements.at(0);
      const last = elements.at(-1);
      if (first === undefined || last === undefined) return;

      // Wrap by hand: without this, Tab walks out of the dialog and into the
      // page behind it, which is exactly what `aria-modal` promises it will not.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose, focusables]);

  if (!open) return null;

  return (
    <div className="mx-sheet__backdrop" onClick={onClose} role="presentation">
      <div
        className={cn('mx-sheet', className)}
        data-variant={variant}
        style={reducedMotion ? { animation: 'none' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-sheet__header">
          <h2 className="mx-card__title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="mx-sheet__body">{children}</div>
        {footer === undefined ? null : <div className="mx-sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}
