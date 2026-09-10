import type { ReactNode } from 'react';
import { SAFETY_BANNER_TEXT } from '@modex/contracts';
import { ShieldCheckIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<SafetyBanner>` — permanent, in every conversation surface (Phase 3 design
 * spec).
 *
 * **There is no dismiss button, and there is no prop that adds one.** A warning
 * that disappears after five seconds is a warning designed to be missed, and a
 * warning a scammer can talk you into hiding is worse than none. The component
 * therefore has no `onDismiss`, no `dismissible`, and no `variant` that renders
 * it as a toast.
 *
 * Brand-tinted rather than red: `--mx-brand-50` with a `--mx-brand-700` left
 * border and `--mx-ink-800` text. This is not an error — nothing has gone wrong
 * — it is the standing rule of the room, and it should read as attention rather
 * than alarm. The one place brand colour is used for something other than the
 * primary action, and it earns it by never competing with one: there is no
 * action in here.
 *
 * The wording comes from the contracts package, so the surface cannot drift
 * from what the API enforces.
 */
export interface SafetyBannerProps {
  /** The report control. Rendered inline, never behind a menu. */
  action?: ReactNode;
  className?: string;
}

export function SafetyBanner({ action, className }: SafetyBannerProps) {
  return (
    <aside className={cn('mx-safety', className)} aria-label="Safety notice">
      <span className="mx-safety__icon">
        <ShieldCheckIcon size={18} />
      </span>
      <p className="mx-safety__text">{SAFETY_BANNER_TEXT}</p>
      {action === undefined ? null : <div className="mx-safety__action">{action}</div>}
    </aside>
  );
}
