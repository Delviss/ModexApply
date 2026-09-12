'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { cn } from '../lib/cn.js';

/**
 * Marquee — the continuously scrolling card rail from the landing hero.
 *
 * Re-themed from the `pulse-fit-hero.tsx` carousel supplied for the landing
 * brief. Three things changed on the way in, and all three are the reason this
 * is a component rather than a `<div>` on the page:
 *
 * 1. **The vendor animates with Framer Motion; this animates with CSS.** The
 *    package has no animation dependency and this needs none — a marquee is one
 *    `translateX` keyframe. Adding a 30 kB runtime to move a row sideways is a
 *    dependency the design system would then carry on every surface.
 * 2. **Moving content needs a pause control (WCAG 2.2.2).** Anything that moves
 *    for more than five seconds must be pausable, and the vendor block has no
 *    control at all. Pausing here does not freeze the row mid-transform — it
 *    swaps to the static, horizontally scrollable version, so every card stays
 *    reachable by mouse, keyboard and screen reader once it stops.
 * 3. **`prefers-reduced-motion` never starts it.** The static row is the render,
 *    and no toggle appears, because there is nothing to toggle.
 *
 * The animated render duplicates the item set so the loop is seamless. The
 * second copy is `aria-hidden` and its links leave the tab order: hiding it
 * alone would leave a keyboard user tabbing through an element screen readers
 * were told is not there — axe calls that `aria-hidden-focus`, and it was a
 * real finding on this rail before the ref below went on.
 */

export interface MarqueeProps {
  items: ReactNode[];
  /** Names the rail for assistive technology — it is a region, not decoration. */
  label: string;
  /** Seconds for one full pass of the set. Longer is calmer. */
  duration?: number;
  /** Label for the pause control, and its paused counterpart. */
  pauseLabel?: string;
  playLabel?: string;
  className?: string;
}

export function Marquee({
  items,
  label,
  duration = 48,
  pauseLabel = 'Pause the scrolling row',
  playLabel = 'Resume the scrolling row',
  className,
}: MarqueeProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);

  /**
   * The echoed set leaves the tab order.
   *
   * An `aria-hidden` list whose links are still tabbable is the failure axe
   * calls `aria-hidden-focus`, and it was a real finding on this rail. The fix
   * is `tabindex="-1"` rather than `inert`, deliberately: `inert` would also
   * kill pointer events, and at any moment roughly half the cards on screen
   * belong to the echo — so inert cards are cards a student clicks and nothing
   * happens. Not tabbable, still clickable, read once.
   *
   * Applied through a callback ref, which fires during commit, so it is set
   * before the browser paints rather than a frame later.
   */
  const hideEchoFromTabOrder = useCallback((node: HTMLUListElement | null) => {
    if (node === null) return;
    for (const focusable of node.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    )) {
      focusable.tabIndex = -1;
    }
  }, []);

  // Reduced motion is a setting, not a state the user toggles here: it renders
  // the still row and offers no control to start it moving.
  const still = reducedMotion || paused;

  if (items.length === 0) return null;

  return (
    <section className={cn('mx-marquee', className)} aria-label={label} data-still={still}>
      <div className="mx-marquee__viewport" tabIndex={still ? 0 : undefined}>
        <ul className="mx-marquee__track" style={still ? undefined : { animationDuration: `${duration}s` }}>
          {items.map((item, index) => (
            <li className="mx-marquee__item" key={`item-${index}`}>
              {item}
            </li>
          ))}
        </ul>
        {still ? null : (
          <ul
            className="mx-marquee__track"
            aria-hidden="true"
            ref={hideEchoFromTabOrder}
            style={{ animationDuration: `${duration}s` }}
          >
            {items.map((item, index) => (
              <li className="mx-marquee__item" key={`echo-${index}`}>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
      {reducedMotion ? null : (
        <button
          type="button"
          className="mx-marquee__toggle"
          aria-pressed={paused}
          onClick={() => setPaused((current) => !current)}
        >
          {paused ? playLabel : pauseLabel}
        </button>
      )}
    </section>
  );
}
