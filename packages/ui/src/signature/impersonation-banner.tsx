import { AlertTriangleIcon } from '../primitives/icons.js';
import { cn } from '../lib/cn.js';

/**
 * `<ImpersonationBanner>` — the persistent notice that somebody is inside
 * somebody else's account (Phase 6 design spec).
 *
 * Like `<SafetyBanner>`, **there is no dismiss control and no prop that adds
 * one.** It spans the whole viewport, it names the operator and the person
 * whose account this is, and it stays for the entire duration. A support visit
 * the account holder can scroll past is a support visit they can miss, and an
 * operator who can hide the banner is an operator working unobserved.
 *
 * `--mx-warning` rather than `--mx-danger`: nothing has gone wrong. Somebody is
 * being helped, with their agreement, and the banner's job is to make that
 * impossible to overlook rather than to alarm.
 *
 * The same component renders on both sides. The operator sees "you are viewing
 * Ada's account"; Ada sees "a Modex support agent is viewing your account".
 * One component, because two would eventually say different things.
 */
export interface ImpersonationBannerProps {
  /** Who is doing the viewing. A name or a support identifier, never an email. */
  operator: string;
  /** Whose account it is. */
  subject: string;
  /** ISO timestamp the window closes at. Rendered as a plain time, not a countdown. */
  expiresAt: string;
  /** The support ticket or trust case this was granted under. */
  reference?: string;
  /** Which side is looking, which changes only the wording. */
  audience?: 'operator' | 'subject';
  /** The operator's "end now" control. Never rendered for the subject's view. */
  action?: React.ReactNode;
  className?: string;
}

export function ImpersonationBanner({
  operator,
  subject,
  expiresAt,
  reference,
  audience = 'operator',
  action,
  className,
}: ImpersonationBannerProps) {
  const until = new Date(expiresAt);
  const time = Number.isNaN(until.getTime())
    ? null
    : until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className={cn('mx-impersonation', className)}
      role="status"
      aria-live="polite"
      data-audience={audience}
    >
      <span className="mx-impersonation__icon" aria-hidden="true">
        <AlertTriangleIcon size={18} />
      </span>
      <p className="mx-impersonation__text">
        {audience === 'operator' ? (
          <>
            You are working inside <strong>{subject}</strong>’s account as{' '}
            <strong>{operator}</strong>. Everything you do here is recorded against your name.
          </>
        ) : (
          <>
            <strong>{operator}</strong>, a Modex support agent, is viewing your account with your
            permission.
          </>
        )}
        {time === null ? null : <> Access ends at {time}.</>}
        {reference === undefined ? null : <> Reference {reference}.</>}
      </p>
      {action === undefined ? null : <div className="mx-impersonation__action">{action}</div>}
    </div>
  );
}
