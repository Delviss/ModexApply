import {
  GUIDE_EXPIRY_URGENT_DAYS,
  GUIDE_EXPIRY_WARNING_DAYS,
  daysUntil,
  guideExpiryUrgency,
} from '@modex/contracts';
import { ClockIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<ExpiryCountdown>` — the guide's own verification clock (Phase 3 design
 * spec): amber at 30 days, red at 7.
 *
 * The thresholds come from the contracts package, which is also what the
 * reverification sweep reads. A dashboard that says "you have plenty of time"
 * while a job restricts the account that evening is the specific failure this
 * shared constant prevents.
 *
 * State is never colour alone — the number of days and what happens next are in
 * the text, for the same reason the verification badge spells out its state.
 */
export interface ExpiryCountdownProps {
  expiresAt: string | null;
  now?: Date;
  className?: string;
}

export function ExpiryCountdown({ expiresAt, now, className }: ExpiryCountdownProps) {
  const at = now ?? new Date();
  const urgency = guideExpiryUrgency(expiresAt, at);

  if (expiresAt === null) {
    return (
      <p className={cn('mx-countdown', className)} data-urgency="none">
        <span className="mx-countdown__icon">
          <ClockIcon size={16} />
        </span>
        No current-student evidence on file yet. You cannot message students until
        it is checked.
      </p>
    );
  }

  const days = daysUntil(expiresAt, at);

  return (
    <p className={cn('mx-countdown', className)} data-urgency={urgency}>
      <span className="mx-countdown__icon">
        <ClockIcon size={16} />
      </span>
      {urgency === 'lapsed' ? (
        <>
          Your student evidence expired {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago.
          Messaging is paused until you reverify — your conversations are still here.
        </>
      ) : (
        <>
          Your student evidence is good for another {days} day{days === 1 ? '' : 's'}.
          {urgency === 'urgent'
            ? ` Reverify now: below ${GUIDE_EXPIRY_URGENT_DAYS} days we start winding your account down.`
            : urgency === 'due'
              ? ` We remind you inside ${GUIDE_EXPIRY_WARNING_DAYS} days so this never comes as a surprise.`
              : ''}
        </>
      )}
    </p>
  );
}
