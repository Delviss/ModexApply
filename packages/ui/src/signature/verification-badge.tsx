import { useId, useState } from 'react';
import {
  effectiveVerificationState,
  type VerificationClaim,
  type VerificationState,
  type VerifiableType,
} from '@modex/contracts';
import { Badge, type BadgeTone } from '../primitives/badge.js';
import {
  ClockIcon,
  HelpCircleIcon,
  ShieldCheckIcon,

  XCircleIcon,
} from '../primitives/icons.js';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * `<VerificationBadge>` — the single most important component on the platform
 * (Phase 0 §2.9).
 *
 * It takes a *claim*, never a boolean. A claim carries who verified it and until
 * when, and this component recomputes the effective state on render, so a claim
 * that expired since it was written renders as `expired` rather than as the
 * stale `verified` sitting in the column.
 *
 * State is always icon + label + colour. Brand crimson never appears here: a
 * verified badge is `--mx-success`, and nothing in this component can make an
 * unverified object look approved.
 */

const PRESENTATION: Record<
  VerificationState,
  { tone: BadgeTone; label: string; Icon: typeof ShieldCheckIcon }
> = {
  verified: { tone: 'success', label: 'Verified', Icon: ShieldCheckIcon },
  pending: { tone: 'warning', label: 'Verification pending', Icon: ClockIcon },
  expired: { tone: 'warning', label: 'Verification expired', Icon: ClockIcon },
  unverified: { tone: 'neutral', label: 'Not verified', Icon: HelpCircleIcon },
  revoked: { tone: 'danger', label: 'Verification revoked', Icon: XCircleIcon },
};

const OBJECT_NOUNS: Record<VerifiableType, string> = {
  institution: 'university',
  program: 'programme',
  offer: 'offer',
  guide: 'student guide',
  review: 'review',
  document: 'document',
};

export interface VerificationBadgeProps {
  claim: VerificationClaim;
  /** `full` shows the evidence summary inline; `compact` puts it behind disclosure. */
  variant?: 'compact' | 'full';
  now?: Date;
  className?: string;
}

export function VerificationBadge({
  claim,
  variant = 'compact',
  now,
  className,
}: VerificationBadgeProps) {
  const [expanded, setExpanded] = useState(variant === 'full');
  const detailsId = useId();
  const state = effectiveVerificationState(claim, now ?? new Date());
  const { tone, label, Icon } = PRESENTATION[state];
  const noun = OBJECT_NOUNS[claim.objectType];

  const verifier =
    claim.verifierName !== null
      ? `${claim.verifierName}${claim.verifierType === 'trust_agent' ? ' (Modex Trust)' : ''}`
      : 'No verifier recorded';

  // Everything a reader needs is in the text, not only in the colour.
  const summaryLine = [
    `${label} ${noun}`,
    claim.verifiedAt !== null ? `checked ${formatDate(claim.verifiedAt)}` : null,
    state === 'verified' && claim.expiresAt !== null ? `valid until ${formatDate(claim.expiresAt)}` : null,
    state === 'expired' && claim.expiresAt !== null ? `lapsed ${formatDate(claim.expiresAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className={cn('mx-verification', className)}>
      <Badge tone={tone} icon={<Icon size={14} />}>
        {label}
        <span className="mx-visually-hidden"> — {summaryLine}</span>
      </Badge>

      {variant === 'compact' ? (
        <button
          type="button"
          className="mx-button"
          data-variant="ghost"
          data-size="sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide evidence' : 'What was checked?'}
        </button>
      ) : null}

      <span className="mx-verification__evidence" id={detailsId} hidden={!expanded}>
        <strong>{verifier}</strong>
        {claim.evidenceSummary !== null ? ` — ${claim.evidenceSummary}` : ' — no evidence summary recorded.'}
        {claim.verifiedAt !== null ? ` Last checked ${formatDate(claim.verifiedAt)}.` : ''}
        {claim.expiresAt !== null
          ? ` ${state === 'expired' ? 'Lapsed' : 'Valid until'} ${formatDate(claim.expiresAt)}.`
          : ''}
      </span>
    </span>
  );
}

/** Convenience for the common "not verified at all" case. */
export function unverifiedClaim(
  objectType: VerifiableType,
  objectId: string,
): VerificationClaim {
  return {
    objectType,
    objectId,
    state: 'unverified',
    verifierName: null,
    verifierType: null,
    verifiedAt: null,
    expiresAt: null,
    evidenceSummary: null,
  };
}
