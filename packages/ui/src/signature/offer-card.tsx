import type { ReactNode } from 'react';
import {
  OFFER_EXPIRY_URGENT_DAYS,
  OFFER_EXPIRY_WARNING_DAYS,
  OFFER_TYPE_LABELS,
  OFFER_DURATION_LABELS,
  daysUntilOfferExpiry,
  formatOfferValue,
  isRenderableOffer,
  offerExpiryUrgency,
  type OfferDuration,
  type OfferExclusion,
  type OfferType,
  type OfferValue,
  type VerificationClaim,
} from '@modex/contracts';
import { Badge } from '../primitives/badge.js';
import { Card } from '../primitives/card.js';
import { AlertTriangleIcon, ClockIcon, SlashIcon } from '../primitives/icons.js';
import { VerificationBadge } from './verification-badge.js';
import { ProvenanceStamp } from './provenance-stamp.js';
import { formatDate } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * `<OfferCard>` — a structured offer, rendered as one (Phase 5 design spec).
 *
 * Four rules are enforced **in this component**, not left to the page:
 *
 *  1. **An offer with no verifier and no last-checked date does not render at
 *     all.** Not greyed out, not "pending" — absent. A page that forgot to
 *     filter its data cannot leak an unverifiable discount through this card.
 *  2. **Exclusions and stacking rules appear on the card**, not behind a "terms
 *     apply" link. If it changes what the student gets, they read it here.
 *  3. **An ineligible offer is visible and explained**, at reduced emphasis on
 *     `--mx-subtle` with the unmet condition in `--mx-warning-text` — never
 *     hidden, and never styled as though it were available.
 *  4. **No countdown timer.** An expiring offer shows `--mx-warning` at 14 days
 *     and `--mx-danger` at 3, with the actual date. A ticking clock is pressure;
 *     a date is information.
 */

export interface OfferCardProps {
  name: string;
  type: OfferType;
  value: OfferValue;
  duration: OfferDuration;
  /** What it is worth against this programme, pre-formatted by the caller. */
  savingLabel?: string | null;
  validUntil: string;
  claimDeadline?: string | null;
  termsSummary?: string | null;
  applicationMethod?: string | null;
  redemptionMethod?: string | null;
  exclusions?: readonly OfferExclusion[];
  sourceRef?: string | null;
  /** Verification, as a claim. There is no boolean form of this prop. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  verificationState: VerificationClaim['state'];
  offerId: string;
  eligible: boolean;
  /** The specific condition the student does not meet. Required when ineligible. */
  unmetCondition?: string | null;
  remedy?: string | null;
  /** True when another offer was applied instead, with the reason. */
  suppressedReason?: string | null;
  now?: Date;
  children?: ReactNode;
  className?: string;
}

export function OfferCard(props: OfferCardProps) {
  const now = props.now ?? new Date();

  // Rule 1, and the reason it lives here. `isRenderableOffer` is the same
  // predicate the API filters on; this is the second line, not the only one.
  if (
    !isRenderableOffer({
      verifiedBy: props.verifiedBy,
      lastCheckedAt: props.lastCheckedAt,
      verificationState: props.verificationState,
    })
  ) {
    return null;
  }

  const urgency = offerExpiryUrgency(props.validUntil, now);
  const days = daysUntilOfferExpiry(props.validUntil, now);
  const claim: VerificationClaim = {
    objectType: 'offer',
    objectId: props.offerId,
    state: props.verificationState,
    verifierName: props.verifiedBy,
    verifierType: 'trust_agent',
    verifiedAt: props.verifiedAt,
    expiresAt: props.validUntil,
    evidenceSummary:
      props.sourceRef === null || props.sourceRef === undefined
        ? null
        : `Checked against the university's published terms at ${props.sourceRef}`,
  };

  return (
    <Card
      className={cn('mx-offer', props.className)}
      data-eligible={props.eligible}
      data-suppressed={props.suppressedReason != null}
      data-urgency={urgency}
    >
      <div className="mx-offer__head">
        <div className="mx-offer__titles">
          <h3 className="mx-offer__name">{props.name}</h3>
          <p className="mx-offer__value">{formatOfferValue(props.value)}</p>
        </div>
        <div className="mx-offer__badges">
          <Badge tone="neutral">{OFFER_TYPE_LABELS[props.type]}</Badge>
          <Badge tone="neutral">{OFFER_DURATION_LABELS[props.duration]}</Badge>
        </div>
      </div>

      {/* Green for money saved. Brand red is for actions and nothing else. */}
      {props.eligible && props.savingLabel != null ? (
        <p className="mx-offer__saving">
          Worth <strong>{props.savingLabel}</strong> to you
        </p>
      ) : null}

      {!props.eligible ? (
        <p className="mx-offer__unmet">
          <SlashIcon size={14} />
          <span>
            <strong>You do not qualify for this yet.</strong>{' '}
            {props.unmetCondition ?? 'We could not check the conditions on this offer.'}
            {props.remedy == null ? '' : ` ${props.remedy}`}
          </span>
        </p>
      ) : null}

      {props.suppressedReason != null ? (
        <p className="mx-offer__unmet" data-reason="suppressed">
          <SlashIcon size={14} />
          <span>
            <strong>Not applied to your price.</strong> {props.suppressedReason}
          </span>
        </p>
      ) : null}

      {props.termsSummary != null ? <p className="mx-offer__terms">{props.termsSummary}</p> : null}

      {/* On the card. Never behind a "terms apply" link. */}
      {props.exclusions !== undefined && props.exclusions.length > 0 ? (
        <ul className="mx-offer__exclusions">
          {props.exclusions.map((exclusion, index) => (
            <li key={`${exclusion.kind}-${index}`}>
              <AlertTriangleIcon size={13} />
              <span>{exclusion.humanSummary}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {props.applicationMethod != null ? (
        <p className="mx-offer__method">
          <strong>How to claim:</strong> {props.applicationMethod}
        </p>
      ) : null}
      {props.redemptionMethod != null ? (
        <p className="mx-offer__method">
          <strong>How to redeem:</strong> {props.redemptionMethod}
        </p>
      ) : null}

      {/*
        A date, not a clock. The urgency attribute colours the row; the sentence
        carries the same information for anyone who cannot see the colour.
      */}
      <p className="mx-offer__deadline" data-urgency={urgency}>
        <ClockIcon size={14} />
        {urgency === 'lapsed' ? (
          <span>This offer closed on {formatDate(props.validUntil)}.</span>
        ) : (
          <span>
            Available until {formatDate(props.validUntil)}
            {urgency === 'urgent'
              ? ` — ${days} day${days === 1 ? '' : 's'} left. Below ${OFFER_EXPIRY_URGENT_DAYS} days we stop showing it as claimable.`
              : urgency === 'due'
                ? ` — ${days} days left. We flag every offer inside ${OFFER_EXPIRY_WARNING_DAYS} days so it does not lapse unnoticed.`
                : '.'}
            {props.claimDeadline == null
              ? ''
              : ` Apply for the award itself by ${formatDate(props.claimDeadline)}.`}
          </span>
        )}
      </p>

      <div className="mx-offer__trust">
        <VerificationBadge claim={claim} now={now} />
        <ProvenanceStamp
          provenance={{
            sourceUpdatedAt: props.lastCheckedAt,
            verifiedAt: props.verifiedAt,
            expiresAt: props.validUntil,
            syncState: props.verificationState === 'verified' ? 'synced' : 'pending_review',
            sourceRef: props.sourceRef ?? null,
            reviewedBy: props.verifiedBy,
          }}
          now={now}
        />
      </div>

      {props.children}
    </Card>
  );
}
