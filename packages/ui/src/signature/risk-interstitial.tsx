import type { ReactNode } from 'react';
import { AlertTriangleIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<RiskInterstitial>` — what a flagged message looks like (Phase 3 design
 * spec).
 *
 * The design decision worth defending: **the message stays visible.** It renders
 * below this notice, unedited, and this component says what was flagged and why.
 *
 * Deleting it would be easier and worse. A student who sees "a message was
 * removed" learns nothing, cannot judge whether we were right, and cannot
 * recognise the next attempt when it arrives somewhere we are not watching.
 * Showing the attempt with an explanation is how the warning teaches rather than
 * merely intervenes — and it is the only version that survives being wrong,
 * because a false positive over an ordinary sentence is visibly a false
 * positive rather than an invisible act of censorship.
 *
 * `--mx-warning`, not `--mx-danger` and never brand crimson: the message is
 * suspect, not fatal, and brand red is reserved for the primary action.
 */
export interface RiskInterstitialProps {
  /** The student-facing explanation, from the anti-scam assessment. */
  warning: string;
  /** Report, always one interaction away — never inside an overflow menu. */
  action?: ReactNode;
  /** The message itself. Rendered unmodified, below the notice. */
  children: ReactNode;
  className?: string;
}

export function RiskInterstitial({ warning, action, children, className }: RiskInterstitialProps) {
  return (
    <div className={cn('mx-risk', className)}>
      <div className="mx-risk__notice" role="alert">
        <span className="mx-risk__icon">
          <AlertTriangleIcon size={18} />
        </span>
        <div className="mx-risk__body">
          <strong className="mx-risk__title">Modex flagged this message</strong>
          <p className="mx-risk__text">{warning}</p>
        </div>
        {action === undefined ? null : <div className="mx-risk__action">{action}</div>}
      </div>
      <div className="mx-risk__message">{children}</div>
    </div>
  );
}
