import { z } from 'zod';
import {
  MoneySchema,
  addMoney,
  applyRate,
  compareMoney,
  formatMoney,
  money,
  type Money,
} from '../primitives/money.js';
import { RULE_TYPES, RuleJsonSchema } from './requirements.js';
import { effectiveVerificationState, VERIFICATION_STATES } from './verification.js';

/**
 * Offers, scholarships, discounts and fee waivers (Phase 5, FR-013 and FR-014).
 *
 * The rule the whole module exists to hold:
 *
 * > Offers are structured objects, not marketing copy. Show the real price
 * > after a discount **only when the eligibility rules are satisfied.**
 *
 * Three consequences follow, and each is a type here rather than a convention:
 *
 *  1. **A value is never a string.** It is integer minor units plus ISO 4217, or
 *     an explicit percentage in basis points, or a benefit with no monetary
 *     value at all. "Up to £5,000 off!" is not representable.
 *  2. **Eligibility reuses the programme rule engine.** An offer condition is
 *     exactly the shape `evaluateRequirement` already takes, so there is one
 *     engine and one set of outcomes — including `missing_data`, which is what
 *     keeps an unassessed student from being told they do not qualify.
 *  3. **Exclusions are data.** "Not combinable with the country award" is a row
 *     with a kind and a target, not a sentence at the bottom of a terms page,
 *     because stacking has to be *computed* and then *explained*.
 */

// ---------------------------------------------------------------------------
// What an offer is
// ---------------------------------------------------------------------------

export const OFFER_TYPES = [
  'scholarship',
  'tuition_discount',
  'application_fee_waiver',
  'deposit_incentive',
  'student_benefit',
] as const;

export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Readonly<Record<OfferType, string>> = Object.freeze({
  scholarship: 'Scholarship',
  tuition_discount: 'Tuition discount',
  application_fee_waiver: 'Application fee waiver',
  deposit_incentive: 'Deposit incentive',
  student_benefit: 'Student benefit',
});

/**
 * Which cost an offer reduces. Mandatory, because a percentage with no base is
 * not a discount, it is a number — and because a fee waiver silently applied to
 * tuition would overstate the saving by three orders of magnitude.
 */
export const OFFER_BASES = ['tuition', 'application_fee', 'deposit', 'none'] as const;
export type OfferBase = (typeof OFFER_BASES)[number];

export const OFFER_BASE_LABELS: Readonly<Record<OfferBase, string>> = Object.freeze({
  tuition: 'Tuition',
  application_fee: 'Application fee',
  deposit: 'Deposit',
  none: 'No cost line',
});

/**
 * How long it lasts. The price panel quotes **first-year** cost, so an offer
 * that only runs for one year and one that runs for the whole course produce the
 * same first-year line and different total savings — and the difference is
 * stated rather than assumed.
 */
export const OFFER_DURATIONS = ['one_off', 'first_year', 'every_year'] as const;
export type OfferDuration = (typeof OFFER_DURATIONS)[number];

export const OFFER_DURATION_LABELS: Readonly<Record<OfferDuration, string>> = Object.freeze({
  one_off: 'One-off',
  first_year: 'First year only',
  every_year: 'Every year of the course',
});

/**
 * The value.
 *
 * `benefit_in_kind` is the deliberate escape hatch for housing, an airport
 * transfer or a paid language test: it carries a named benefit and a named
 * provider, and it contributes **nothing** to the net price. Assigning it a
 * notional cash value would be exactly the marketing arithmetic this phase is
 * supposed to end.
 */
export const OfferValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('percentage'),
    /** 1 = 0.01%. A 12.5% discount is 1250, with no float anywhere. */
    basisPoints: z.number().int().min(1).max(10_000),
  }),
  z.object({ kind: z.literal('fixed_amount'), amount: MoneySchema }),
  z.object({ kind: z.literal('full_waiver') }),
  z.object({
    kind: z.literal('benefit_in_kind'),
    benefit: z.string().min(3, 'Name the benefit'),
    provider: z.string().min(1, 'Name who provides it'),
  }),
]);

export type OfferValue = z.infer<typeof OfferValueSchema>;

/** Display only — like `formatMoney`, never fed back into a calculation. */
export function formatOfferValue(value: OfferValue, locale = 'en-GB'): string {
  switch (value.kind) {
    case 'percentage':
      return `${formatBasisPoints(value.basisPoints)}% off`;
    case 'fixed_amount':
      return `${formatMoney(value.amount, locale)} off`;
    case 'full_waiver':
      return 'Waived in full';
    case 'benefit_in_kind':
      return `${value.benefit} (provided by ${value.provider})`;
  }
}

/** 1250 → "12.5", 1000 → "10". Integer maths; no float rounding to explain. */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

// ---------------------------------------------------------------------------
// Conditions — the same rule engine as programme eligibility
// ---------------------------------------------------------------------------

/**
 * One condition on an offer.
 *
 * Structurally identical to a `Requirement`, on purpose: the API hands these
 * straight to `evaluateRequirement`. Two engines would drift, and the day they
 * drifted a student would be told they qualify for a programme and not for its
 * own scholarship on the same GPA.
 */
export const OfferConditionSchema = z.object({
  id: z.string(),
  ruleType: z.enum(RULE_TYPES),
  ruleJson: RuleJsonSchema,
  humanSummary: z.string().min(10, 'Every offer condition needs a human-readable summary'),
  sourceRef: z.string().min(1, 'Every offer condition must cite where it came from'),
});

export type OfferCondition = z.infer<typeof OfferConditionSchema>;

// ---------------------------------------------------------------------------
// Exclusions — first-class, never buried in terms text
// ---------------------------------------------------------------------------

export const OFFER_EXCLUSION_KINDS = [
  /** Refuses to combine with one named offer. */
  'not_combinable_with_offer',
  /** Refuses to combine with a whole category, e.g. any other scholarship. */
  'not_combinable_with_type',
  /** Applies to the first year of study only. */
  'first_year_only',
  /** New entrants only — not for continuing or transferring students. */
  'new_students_only',
  /** Conditional on paying the year up front. */
  'requires_full_upfront_payment',
  /** Named programmes are carved out of an otherwise institution-wide offer. */
  'excludes_programmes',
] as const;

export type OfferExclusionKind = (typeof OFFER_EXCLUSION_KINDS)[number];

export const OfferExclusionSchema = z.object({
  kind: z.enum(OFFER_EXCLUSION_KINDS),
  /** The other offer, for `not_combinable_with_offer`. */
  otherOfferKey: z.string().nullable().default(null),
  /** The other category, for `not_combinable_with_type`. */
  otherOfferType: z.enum(OFFER_TYPES).nullable().default(null),
  /** Programme keys carved out, for `excludes_programmes`. */
  programKeys: z.array(z.string()).default([]),
  /**
   * The sentence that renders **on the card**. Mandatory for the same reason a
   * requirement's is: an exclusion nobody can read is an exclusion nobody can
   * contest, and it will be discovered at the worst possible moment.
   */
  humanSummary: z.string().min(10, 'Every exclusion needs a human-readable summary'),
});

export type OfferExclusion = z.infer<typeof OfferExclusionSchema>;

// ---------------------------------------------------------------------------
// The offer record
// ---------------------------------------------------------------------------

export const OFFER_PUBLICATION_STATES = [
  'draft',
  'in_review',
  'published',
  'unpublished',
  'expired',
] as const;

export type OfferPublicationState = (typeof OFFER_PUBLICATION_STATES)[number];

export const OfferSchema = z.object({
  id: z.string(),
  /** Stable across every effective-dated version, like `Program.programKey`. */
  offerKey: z.string().min(1),
  version: z.number().int().min(1),
  institutionId: z.string(),
  /** Null means institution-wide: every published programme, minus exclusions. */
  programKey: z.string().nullable(),
  type: z.enum(OFFER_TYPES),
  name: z.string().min(3),
  value: OfferValueSchema,
  appliesTo: z.enum(OFFER_BASES),
  duration: z.enum(OFFER_DURATIONS),
  conditions: z.array(OfferConditionSchema),
  exclusions: z.array(OfferExclusionSchema),
  /** Plain-language conditions. Not a substitute for `exclusions`. */
  termsSummary: z.string().nullable(),
  /** How a student claims it — mandatory for a scholarship. */
  applicationMethod: z.string().nullable(),
  /** How a benefit is redeemed, and who provides it. */
  redemptionMethod: z.string().nullable(),
  /** The award's own deadline, which is not the intake deadline. */
  claimDeadline: z.iso.datetime().nullable(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  publicationState: z.enum(OFFER_PUBLICATION_STATES),
  verificationState: z.enum(VERIFICATION_STATES),
  verifiedBy: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  /**
   * When somebody last looked at the source and confirmed this is still what it
   * says. Distinct from `verifiedAt`: verification is the decision, this is the
   * re-check, and an offer whose last check is older than its freshness SLA is
   * stale whatever its verification column says.
   */
  lastCheckedAt: z.iso.datetime().nullable(),
  sourceRef: z.string().nullable(),
});

export type Offer = z.infer<typeof OfferSchema>;

// ---------------------------------------------------------------------------
// The publication gate
// ---------------------------------------------------------------------------

/**
 * Everything an offer must carry before it can be published as a Verified
 * Offer (acceptance criterion 1).
 *
 * Returned as a list rather than a boolean so the admin screen can say what is
 * missing instead of refusing with "invalid". The API enforces this on the
 * publish path and the database enforces the column-level half of it; a
 * reviewer's diligence is not the control.
 */
export function offerPublicationBlockers(
  offer: Pick<
    Offer,
    | 'type'
    | 'value'
    | 'appliesTo'
    | 'conditions'
    | 'sourceRef'
    | 'validFrom'
    | 'validUntil'
    | 'claimDeadline'
    | 'termsSummary'
    | 'applicationMethod'
    | 'redemptionMethod'
    | 'verificationState'
    | 'verifiedBy'
    | 'verifiedAt'
    | 'lastCheckedAt'
  >,
): string[] {
  const blockers: string[] = [];

  if (offer.sourceRef === null || offer.sourceRef.trim() === '') {
    blockers.push('A source reference: where at the university this offer is published.');
  }
  if (offer.conditions.length === 0) {
    blockers.push(
      'At least one eligibility condition. An offer with no conditions is a price change, not an offer.',
    );
  }
  if (offer.termsSummary === null || offer.termsSummary.trim() === '') {
    blockers.push('The conditions, in plain language.');
  }
  if (offer.verifiedBy === null || offer.verifiedBy.trim() === '') {
    blockers.push('A named verifier.');
  }
  if (offer.verifiedAt === null) {
    blockers.push('The date it was verified.');
  }
  if (offer.lastCheckedAt === null) {
    blockers.push('The date the source was last checked.');
  }
  if (offer.verificationState !== 'verified') {
    blockers.push('Verification: Modex Trust has not signed this offer off yet.');
  }
  if (new Date(offer.validUntil).getTime() <= new Date(offer.validFrom).getTime()) {
    blockers.push('A validity window that ends after it starts.');
  }

  // Per-type required fields, straight from the issue's table.
  if (offer.type === 'scholarship') {
    if (offer.claimDeadline === null) {
      blockers.push('A deadline: a scholarship students cannot date is a scholarship they miss.');
    }
    if (offer.applicationMethod === null || offer.applicationMethod.trim() === '') {
      blockers.push('The application method: how a student actually claims it.');
    }
  }
  if (offer.type === 'student_benefit') {
    if (offer.value.kind !== 'benefit_in_kind') {
      blockers.push(
        'A student benefit carries a named benefit and provider, not a cash value.',
      );
    }
    if (offer.redemptionMethod === null || offer.redemptionMethod.trim() === '') {
      blockers.push('The redemption method: how the student claims the benefit.');
    }
  }
  if (offer.type !== 'student_benefit' && offer.value.kind === 'benefit_in_kind') {
    blockers.push('Only a student benefit may carry a benefit instead of a value.');
  }
  if (offer.value.kind === 'benefit_in_kind' && offer.appliesTo !== 'none') {
    blockers.push('A benefit reduces no cost line, so it cannot be attached to one.');
  }
  if (offer.value.kind !== 'benefit_in_kind' && offer.appliesTo === 'none') {
    blockers.push('Say which cost this reduces: tuition, the application fee, or the deposit.');
  }
  if (offer.type === 'application_fee_waiver' && offer.appliesTo !== 'application_fee') {
    blockers.push('An application fee waiver applies to the application fee.');
  }
  if (offer.type === 'deposit_incentive' && offer.appliesTo !== 'deposit') {
    blockers.push('A deposit incentive applies to the deposit.');
  }

  return blockers;
}

export function canPublishOffer(
  offer: Parameters<typeof offerPublicationBlockers>[0],
): { ok: boolean; blockers: string[] } {
  const blockers = offerPublicationBlockers(offer);
  return { ok: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Validity and expiry
// ---------------------------------------------------------------------------

/**
 * Deadline thresholds (Phase 5 design spec): amber at 14 days, red at 3.
 *
 * The auto-expiry sweep reads the same constants the card does, which is what
 * stops a card saying "3 days left" on an offer a job pulled that morning.
 */
export const OFFER_EXPIRY_WARNING_DAYS = 14;
export const OFFER_EXPIRY_URGENT_DAYS = 3;

export const OFFER_EXPIRY_URGENCIES = ['none', 'due', 'urgent', 'lapsed'] as const;
export type OfferExpiryUrgency = (typeof OFFER_EXPIRY_URGENCIES)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days remaining, rounded towards the student's disadvantage. */
export function daysUntilOfferExpiry(validUntil: string, now: Date = new Date()): number {
  return Math.floor((new Date(validUntil).getTime() - now.getTime()) / MS_PER_DAY);
}

export function offerExpiryUrgency(
  validUntil: string | null,
  now: Date = new Date(),
): OfferExpiryUrgency {
  if (validUntil === null) return 'none';
  const remaining = new Date(validUntil).getTime() - now.getTime();
  if (remaining <= 0) return 'lapsed';
  const days = daysUntilOfferExpiry(validUntil, now);
  if (days <= OFFER_EXPIRY_URGENT_DAYS) return 'urgent';
  if (days <= OFFER_EXPIRY_WARNING_DAYS) return 'due';
  return 'none';
}

/**
 * Whether an offer may be shown, priced or recommended at all.
 *
 * Read paths call this rather than trusting `publicationState`, for the same
 * reason `effectiveVerificationState` exists: the column says what a job last
 * wrote, and this says what is true now. An offer that lapsed twenty minutes ago
 * is not live, whichever sweep has not run yet.
 */
export function isOfferLive(
  offer: Pick<
    Offer,
    'publicationState' | 'verificationState' | 'verifiedAt' | 'validFrom' | 'validUntil'
  >,
  now: Date = new Date(),
): boolean {
  if (offer.publicationState !== 'published') return false;
  // An offer's verification cannot outlive the offer: nobody can stand behind a
  // discount for longer than the window in which it exists, so the validity end
  // is the claim's expiry rather than a second, separately-drifting date.
  if (
    effectiveVerificationState(
      { state: offer.verificationState, expiresAt: offer.validUntil },
      now,
    ) !== 'verified'
  ) {
    return false;
  }
  return (
    new Date(offer.validFrom).getTime() <= now.getTime() &&
    new Date(offer.validUntil).getTime() > now.getTime()
  );
}

/**
 * The component-level guard behind "an offer without a verifier and a
 * last-checked date must not render at all" — enforced in the component, not in
 * the page, so a new surface cannot forget it.
 */
export function isRenderableOffer(
  offer: Pick<Offer, 'verifiedBy' | 'lastCheckedAt' | 'verificationState'>,
): boolean {
  return (
    offer.verifiedBy !== null &&
    offer.verifiedBy.trim() !== '' &&
    offer.lastCheckedAt !== null &&
    offer.verificationState !== 'unverified'
  );
}

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

export interface StackingCandidate {
  offerKey: string;
  offerId: string;
  type: OfferType;
  name: string;
  appliesTo: OfferBase;
  exclusions: readonly OfferExclusion[];
  /** What this offer would save on its own, already computed against the base. */
  saving: Money;
  /**
   * True when this offer alone takes its cost line to zero — a full waiver, or a
   * fixed award at least as large as the fee. Computed by the caller, which is
   * the only party that knows the amounts; the resolver needs the fact, not the
   * arithmetic.
   */
  exhaustsBase: boolean;
  /** Institution-wide offers lose ties to programme-specific ones. */
  programKey: string | null;
}

export interface SuppressedOffer {
  offerKey: string;
  offerId: string;
  name: string;
  /** The offer that won, when one did. */
  supersededBy: string | null;
  reason: string;
}

export interface StackingDecision {
  applied: StackingCandidate[];
  suppressed: SuppressedOffer[];
}

/**
 * Do these two refuse to combine? Symmetric: an exclusion declared by either
 * side is binding, because a partner who writes "not combinable with the merit
 * award" on one of the pair has said everything they need to say.
 */
export function offersConflict(a: StackingCandidate, b: StackingCandidate): OfferExclusion | null {
  for (const [left, right] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const exclusion of left.exclusions) {
      if (exclusion.kind === 'not_combinable_with_offer' && exclusion.otherOfferKey === right.offerKey) {
        return exclusion;
      }
      if (exclusion.kind === 'not_combinable_with_type' && exclusion.otherOfferType === right.type) {
        return exclusion;
      }
    }
  }
  return null;
}

/**
 * Resolve stacking.
 *
 * Greedy, best-saving-first, and deliberately *not* clever: the student keeps
 * the largest saving available, and every offer that lost is listed with the
 * offer it lost to and the exclusion that decided it. A smarter search could
 * occasionally find a better combination of two small awards than one large one,
 * and would be unexplainable when it did; "we applied the biggest one we could,
 * and here is what it displaced" is a sentence a student can check.
 *
 * Ordering is total and stable — saving descending, then programme-specific
 * before institution-wide, then offer key — so the same inputs always produce the
 * same applied set, which is what makes a price breakdown reproducible.
 *
 * `saving` here is each offer's **standalone** value, which is what "saves you
 * more" has to mean while deciding: the moment two offers are ranked by what
 * they would be worth *after* one another, the winner depends on the order the
 * caller happened to pass them in. The amount actually deducted compounds
 * against the running balance, and that happens in `computePriceBreakdown`.
 */
export function resolveStacking(candidates: readonly StackingCandidate[]): StackingDecision {
  const ordered = [...candidates].sort((a, b) => {
    const bySaving = compareMoney(b.saving, a.saving);
    if (bySaving !== 0) return bySaving;
    const aSpecific = a.programKey === null ? 1 : 0;
    const bSpecific = b.programKey === null ? 1 : 0;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    return a.offerKey.localeCompare(b.offerKey);
  });

  const applied: StackingCandidate[] = [];
  const suppressed: SuppressedOffer[] = [];
  /** Bases already reduced to nothing. A second discount on them saves nobody anything. */
  const exhaustedBases = new Set<OfferBase>();

  for (const candidate of ordered) {
    const conflictWith = applied.find((chosen) => offersConflict(chosen, candidate) !== null);
    if (conflictWith !== undefined) {
      const exclusion = offersConflict(conflictWith, candidate)!;
      suppressed.push({
        offerKey: candidate.offerKey,
        offerId: candidate.offerId,
        name: candidate.name,
        supersededBy: conflictWith.name,
        reason: `${exclusion.humanSummary} We applied ${conflictWith.name} instead, because it saves you more.`,
      });
      continue;
    }

    if (candidate.appliesTo !== 'none' && exhaustedBases.has(candidate.appliesTo)) {
      suppressed.push({
        offerKey: candidate.offerKey,
        offerId: candidate.offerId,
        name: candidate.name,
        supersededBy: null,
        reason: `${OFFER_BASE_LABELS[candidate.appliesTo]} is already reduced to nothing by another offer, so this one would save you nothing on top.`,
      });
      continue;
    }

    applied.push(candidate);
    if (candidate.exhaustsBase && candidate.appliesTo !== 'none') {
      exhaustedBases.add(candidate.appliesTo);
    }
  }

  return { applied, suppressed };
}

// ---------------------------------------------------------------------------
// Price breakdown
// ---------------------------------------------------------------------------

export interface PriceableOffer {
  offerId: string;
  offerKey: string;
  /** Pinned: the breakdown traces to a *version*, not to "the offer". */
  version: number;
  name: string;
  type: OfferType;
  value: OfferValue;
  appliesTo: OfferBase;
  duration: OfferDuration;
  exclusions: readonly OfferExclusion[];
  sourceRef: string | null;
  programKey: string | null;
  validUntil: string;
}

export interface PriceLine {
  kind: 'cost' | 'saving';
  label: string;
  base: OfferBase;
  amount: Money;
  /** Non-null on every saving line — this is what makes the net price traceable. */
  offerId: string | null;
  offerKey: string | null;
  offerVersion: number | null;
  sourceRef: string | null;
  duration: OfferDuration | null;
}

export interface IneligibleOffer {
  offerId: string;
  offerKey: string;
  name: string;
  /** The specific unmet condition, in the student's words. Never a summary. */
  unmetCondition: string;
  /** What they could do about it, when there is something. */
  remedy: string | null;
  outcome: 'fail' | 'missing_data' | 'unknown';
}

export interface PriceBreakdown {
  currency: string;
  lines: PriceLine[];
  grossTotal: Money;
  totalSaving: Money;
  netPrice: Money;
  applied: PriceableOffer[];
  suppressed: SuppressedOffer[];
  ineligible: IneligibleOffer[];
  /** Offers skipped because their currency differs from the cost they reduce. */
  unpriceable: { offerId: string; offerKey: string; name: string; reason: string }[];
  computedAt: string;
}

export interface PriceInput {
  tuition: Money;
  applicationFee: Money | null;
  deposit: Money | null;
  /** Already filtered to offers the student is eligible for and that are live. */
  eligible: readonly PriceableOffer[];
  /** Shown with their unmet condition, never included in the net price. */
  ineligible: readonly IneligibleOffer[];
  now?: Date;
}

function baseAmount(input: PriceInput, base: OfferBase): Money | null {
  switch (base) {
    case 'tuition':
      return input.tuition;
    case 'application_fee':
      return input.applicationFee;
    case 'deposit':
      return input.deposit;
    case 'none':
      return null;
  }
}

/** What one offer takes off one cost. Integer maths throughout — see `applyRate`. */
export function savingFor(offer: PriceableOffer, base: Money): Money {
  switch (offer.value.kind) {
    case 'percentage':
      return applyRate(base, offer.value.basisPoints, 10_000);
    case 'fixed_amount':
      // A £6,000 award against a £5,000 fee saves £5,000. Nobody gets change.
      return compareMoney(offer.value.amount, base) > 0 ? base : offer.value.amount;
    case 'full_waiver':
      return base;
    case 'benefit_in_kind':
      return money(0, base.currency);
  }
}

/**
 * The price breakdown: tuition → applicable offers → net price, every line
 * attributed to the offer version and source that produced it.
 *
 * Quotes the **first year**, which is the only figure that is both comparable
 * across universities and actually payable. An offer that runs for the whole
 * course says so on its line rather than being multiplied out here against a
 * duration the catalogue does not promise.
 */
export function computePriceBreakdown(input: PriceInput): PriceBreakdown {
  const now = input.now ?? new Date();
  const currency = input.tuition.currency;

  const lines: PriceLine[] = [
    {
      kind: 'cost',
      label: 'Tuition (first year)',
      base: 'tuition',
      amount: input.tuition,
      offerId: null,
      offerKey: null,
      offerVersion: null,
      sourceRef: null,
      duration: null,
    },
  ];
  if (input.applicationFee !== null) {
    lines.push({
      kind: 'cost',
      label: 'Application fee',
      base: 'application_fee',
      amount: input.applicationFee,
      offerId: null,
      offerKey: null,
      offerVersion: null,
      sourceRef: null,
      duration: null,
    });
  }
  if (input.deposit !== null) {
    lines.push({
      kind: 'cost',
      label: 'Deposit',
      base: 'deposit',
      amount: input.deposit,
      offerId: null,
      offerKey: null,
      offerVersion: null,
      sourceRef: null,
      duration: null,
    });
  }

  const unpriceable: PriceBreakdown['unpriceable'] = [];
  const candidates: StackingCandidate[] = [];
  const byKey = new Map<string, PriceableOffer>();

  for (const offer of input.eligible) {
    byKey.set(offer.offerKey, offer);
    const base = baseAmount(input, offer.appliesTo);

    if (base === null) {
      // A benefit in kind, or an offer against a cost this programme does not
      // charge. Either way it reduces nothing, and saying otherwise would be
      // the marketing arithmetic this module exists to refuse.
      candidates.push({
        offerKey: offer.offerKey,
        offerId: offer.offerId,
        type: offer.type,
        name: offer.name,
        appliesTo: offer.appliesTo,
        exclusions: offer.exclusions,
        saving: money(0, currency),
        exhaustsBase: false,
        programKey: offer.programKey,
      });
      continue;
    }

    if (offer.value.kind === 'fixed_amount' && offer.value.amount.currency !== base.currency) {
      // Never convert with an undated rate. An offer we cannot price is listed
      // as exactly that, rather than quietly dropped or wrongly counted.
      unpriceable.push({
        offerId: offer.offerId,
        offerKey: offer.offerKey,
        name: offer.name,
        reason: `This award is in ${offer.value.amount.currency} and the ${OFFER_BASE_LABELS[offer.appliesTo].toLowerCase()} is in ${base.currency}. We do not convert currencies to make a saving look bigger — ask the university what it is worth against this fee.`,
      });
      continue;
    }

    const saving = savingFor(offer, base);
    candidates.push({
      offerKey: offer.offerKey,
      offerId: offer.offerId,
      type: offer.type,
      name: offer.name,
      appliesTo: offer.appliesTo,
      exclusions: offer.exclusions,
      saving,
      exhaustsBase: base.amountMinor > 0 && saving.amountMinor >= base.amountMinor,
      programKey: offer.programKey,
    });
  }

  const decision = resolveStacking(candidates);

  // Bases are reduced in the order the offers were applied, so two partial
  // discounts on the same cost compound against the remaining balance rather
  // than both against the original — which is what a university actually does,
  // and what stops two 60% discounts producing a negative price.
  const remaining = new Map<OfferBase, Money>();
  for (const base of ['tuition', 'application_fee', 'deposit'] as const) {
    const amount = baseAmount(input, base);
    if (amount !== null) remaining.set(base, amount);
  }

  const applied: PriceableOffer[] = [];
  let totalSaving = money(0, currency);

  for (const candidate of decision.applied) {
    const offer = byKey.get(candidate.offerKey)!;
    applied.push(offer);

    // No remaining balance means a benefit in kind, or a cost this programme
    // does not charge. The offer stays in `applied` — the student really does
    // get it — it just has no money line.
    const base = remaining.get(candidate.appliesTo);
    if (base === undefined) continue;

    const saving = savingFor(offer, base);
    if (saving.amountMinor === 0) continue;

    remaining.set(candidate.appliesTo, money(base.amountMinor - saving.amountMinor, base.currency));
    totalSaving = addMoney(totalSaving, saving);

    lines.push({
      kind: 'saving',
      label: offer.name,
      base: candidate.appliesTo,
      amount: saving,
      offerId: offer.offerId,
      offerKey: offer.offerKey,
      offerVersion: offer.version,
      sourceRef: offer.sourceRef,
      duration: offer.duration,
    });
  }

  const grossTotal = lines
    .filter((line) => line.kind === 'cost')
    .reduce((total, line) => addMoney(total, line.amount), money(0, currency));

  return {
    currency,
    lines,
    grossTotal,
    totalSaving,
    netPrice: money(grossTotal.amountMinor - totalSaving.amountMinor, currency),
    applied,
    suppressed: decision.suppressed,
    ineligible: [...input.ineligible],
    unpriceable,
    computedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Attachment to an application, and the admission offer
// ---------------------------------------------------------------------------

export const OFFER_ATTACHMENT_STATES = [
  'attached',
  'accepted',
  'declined',
  'expired',
  'realised',
  'superseded',
] as const;

export type OfferAttachmentState = (typeof OFFER_ATTACHMENT_STATES)[number];

export const OFFER_ATTACHMENT_LABELS: Readonly<Record<OfferAttachmentState, string>> = Object.freeze(
  {
    attached: 'Attached to this application',
    accepted: 'Accepted',
    declined: 'Declined',
    expired: 'Lapsed before it could be used',
    realised: 'Realised at enrolment',
    superseded: 'Replaced by a newer version of this offer',
  },
);

const ATTACHMENT_TRANSITIONS: Readonly<Record<OfferAttachmentState, readonly OfferAttachmentState[]>> =
  Object.freeze({
    attached: ['accepted', 'declined', 'expired', 'superseded'],
    accepted: ['realised', 'declined', 'expired'],
    declined: [],
    expired: [],
    realised: [],
    superseded: [],
  });

export function canTransitionAttachment(
  from: OfferAttachmentState,
  to: OfferAttachmentState,
): boolean {
  return ATTACHMENT_TRANSITIONS[from].includes(to);
}

/**
 * The **admission** offer: the university's decision on the application.
 *
 * Kept in its own shape, with its own vocabulary, because the single most
 * damaging thing this phase could do is let "you have an offer" mean a discount
 * on a search card and an admission decision on a dashboard. A conditional
 * admission offer is not a scholarship, and no component takes both.
 */
export const ADMISSION_OFFER_KINDS = ['conditional', 'unconditional'] as const;
export type AdmissionOfferKind = (typeof ADMISSION_OFFER_KINDS)[number];

export const AdmissionConditionSchema = z.object({
  summary: z.string().min(3),
  met: z.boolean(),
  /** Evidence the university named, when they named any. */
  evidence: z.string().nullable().default(null),
});

export const AdmissionOfferSchema = z.object({
  applicationId: z.string(),
  kind: z.enum(ADMISSION_OFFER_KINDS),
  conditions: z.array(AdmissionConditionSchema),
  issuedAt: z.iso.datetime(),
  /** The university's own deadline for a reply. */
  respondByAt: z.iso.datetime().nullable(),
  /** The university's reference for this decision. */
  externalRef: z.string().nullable(),
  notes: z.string().nullable(),
});

export type AdmissionOffer = z.infer<typeof AdmissionOfferSchema>;

export function admissionOfferSummary(offer: AdmissionOffer): string {
  if (offer.kind === 'unconditional') {
    return 'The university has offered you a place with no outstanding conditions.';
  }
  const outstanding = offer.conditions.filter((condition) => !condition.met).length;
  if (outstanding === 0) {
    return 'The university has offered you a place, and you have met every condition they set.';
  }
  return `The university has offered you a place with ${outstanding} condition${outstanding === 1 ? '' : 's'} still to meet.`;
}

// ---------------------------------------------------------------------------
// Savings reporting
// ---------------------------------------------------------------------------

export interface RealisedSaving {
  offerId: string;
  offerKey: string;
  state: OfferAttachmentState;
  verificationState: (typeof VERIFICATION_STATES)[number];
  amount: Money | null;
}

/**
 * The **scholarship savings** success metric (epic §1).
 *
 * Counts only what was verified *and* realised at enrolment. A discount a
 * student was eligible for and never used is not a saving, and a reported
 * figure that included it would be a marketing number with an audit trail —
 * the worst of both.
 */
export function savingsSecured(entries: readonly RealisedSaving[], currency: string): Money {
  return entries
    .filter(
      (entry) =>
        entry.state === 'realised' &&
        entry.verificationState === 'verified' &&
        entry.amount !== null &&
        entry.amount.currency === currency,
    )
    .reduce((total, entry) => addMoney(total, entry.amount!), money(0, currency));
}
