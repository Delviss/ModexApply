import { z } from 'zod';
import { GUIDE_TOPICS } from './guides.js';

/**
 * Guide sessions, availability and rewards (Phase 3 §3 and §5).
 *
 * Two rules are enforced here rather than described:
 *
 *  1. **No direct payment path to a guide.** A session has no amount, no payee
 *     and no payment reference. Rewards are a separate ledger, owed by Modex,
 *     and the finance surface in #8 pays them. There is nowhere in this module
 *     for a student's money to go.
 *
 *  2. **Reward is never tied to an admission outcome.** `rewardStateForSession`
 *     takes session facts and refuses — at runtime, loudly — to be handed an
 *     application status. Acceptance criterion 5 asks for a test that an attempt
 *     to link them fails; `FORBIDDEN_REWARD_INPUTS` is what that test fails
 *     against, and it fails in production too rather than only in CI.
 */

export const SESSION_CHANNELS = ['chat', 'audio', 'video'] as const;
export type SessionChannel = (typeof SESSION_CHANNELS)[number];

export const SESSION_STATUSES = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_DURATION_MINUTES = [15, 30, 45, 60] as const;

/** Booking window. Far enough ahead to plan, near enough that a slot is real. */
export const BOOKING_HORIZON_DAYS = 42;

export const AvailabilitySlotSchema = z.object({
  id: z.string(),
  guideId: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  topics: z.array(z.enum(GUIDE_TOPICS)),
  /** Almost always 1. Group sessions are the exception, not the model. */
  capacity: z.number().int().min(1).max(20),
  booked: z.number().int().min(0),
});

export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export function slotHasCapacity(slot: Pick<AvailabilitySlot, 'capacity' | 'booked'>): boolean {
  return slot.booked < slot.capacity;
}

/**
 * Whether a slot can still be booked.
 *
 * "Bookable" is capacity *and* time: a slot with a free place that started ten
 * minutes ago is not bookable, and the calendar greys it out rather than
 * accepting the booking and failing afterwards (Phase 3 design spec).
 */
export function isSlotBookable(
  slot: Pick<AvailabilitySlot, 'capacity' | 'booked' | 'startsAt'>,
  now: Date = new Date(),
): boolean {
  return slotHasCapacity(slot) && new Date(slot.startsAt) > now;
}

/** Why a slot is not offered, for the calendar's title attribute. */
export function slotBlockReason(
  slot: Pick<AvailabilitySlot, 'capacity' | 'booked' | 'startsAt'>,
  now: Date = new Date(),
): string | null {
  if (new Date(slot.startsAt) <= now) return 'This time has passed.';
  if (!slotHasCapacity(slot)) return 'Fully booked.';
  return null;
}

export function slotsOverlap(
  left: Pick<AvailabilitySlot, 'startsAt' | 'endsAt'>,
  right: Pick<AvailabilitySlot, 'startsAt' | 'endsAt'>,
): boolean {
  return (
    new Date(left.startsAt) < new Date(right.endsAt) &&
    new Date(right.startsAt) < new Date(left.endsAt)
  );
}

/**
 * Overbooking is prevented by the platform, not by the guide (Phase 3 §2).
 *
 * The API holds the row lock and re-reads `booked` inside the transaction; this
 * function is the same rule expressed where the guide's availability editor can
 * use it, so a guide is told about a clash while they are creating it.
 */
export function conflictsWithExisting(
  candidate: Pick<AvailabilitySlot, 'startsAt' | 'endsAt'>,
  existing: readonly Pick<AvailabilitySlot, 'startsAt' | 'endsAt'>[],
): boolean {
  return existing.some((slot) => slotsOverlap(candidate, slot));
}

export const GuideSessionSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  guideId: z.string(),
  slotId: z.string().nullable(),
  channel: z.enum(SESSION_CHANNELS),
  scheduledFor: z.iso.datetime(),
  durationMinutes: z.number().int().positive(),
  status: z.enum(SESSION_STATUSES),
  topics: z.array(z.enum(GUIDE_TOPICS)),
  /**
   * Modex-managed joining detail. A room reference, never a personal phone
   * number: a booked call must not become a channel for the contact details
   * this phase keeps private.
   */
  joinRef: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancellationReason: z.string().nullable(),
});

export type GuideSession = z.infer<typeof GuideSessionSchema>;

const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = Object.freeze({
  requested: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
});

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Rewards (Phase 3 §5)
// ---------------------------------------------------------------------------

export const REWARD_KINDS = [
  'fixed_stipend',
  'platform_credit',
  'scholarship_contribution',
  'certificate',
  'university_supported',
] as const;

export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_STATES = [
  'not_earned',
  'earned',
  'approved',
  'paid',
  'withheld',
] as const;

export type RewardState = (typeof REWARD_STATES)[number];

/**
 * Inputs that must never reach the reward decision.
 *
 * Named rather than merely absent, because "absent" is a property nobody can
 * test. `rewardStateForSession` throws when it sees one of these keys, so the
 * attempt to wire an admission outcome into a payout fails at the call site,
 * in every environment, rather than passing review and failing a promise.
 */
export const FORBIDDEN_REWARD_INPUTS = [
  'applicationStatus',
  'applicationId',
  'admissionOutcome',
  'offerStatus',
  'offerId',
  'visaOutcome',
  'enrolmentStatus',
  'conversionRate',
  'commission',
] as const;

export class RewardLinkageError extends Error {
  constructor(readonly key: string) {
    super(
      `Reward state must not depend on "${key}". A guide is paid for the session they gave, never for what the university decided afterwards (Phase 3 §5).`,
    );
    this.name = 'RewardLinkageError';
  }
}

/** The session facts a reward may legitimately depend on. */
export interface RewardInput {
  status: SessionStatus;
  completedAt: string | null;
  /** An open trust case against the guide withholds the reward pending review. */
  trustCaseOpen: boolean;
  /** The student marked the session as not delivered. */
  disputed: boolean;
}

/**
 * The reward decision.
 *
 * Every branch reads only session delivery: did the session happen, is the
 * guide under review, did the student dispute it. There is no branch that could
 * read an application, and the guard above means there is no way to smuggle one
 * in through an extra property.
 */
export function rewardStateForSession(input: RewardInput & Record<string, unknown>): RewardState {
  for (const key of FORBIDDEN_REWARD_INPUTS) {
    if (Object.hasOwn(input, key)) throw new RewardLinkageError(key);
  }

  if (input.status !== 'completed' && input.status !== 'no_show') return 'not_earned';
  // A no-show by the student still cost the guide the hour they held open.
  if (input.disputed) return 'withheld';
  if (input.trustCaseOpen) return 'withheld';
  return input.completedAt === null ? 'not_earned' : 'earned';
}

const REWARD_TRANSITIONS: Readonly<Record<RewardState, readonly RewardState[]>> = Object.freeze({
  not_earned: ['earned'],
  earned: ['approved', 'withheld'],
  approved: ['paid', 'withheld'],
  // Paid is terminal. A reversal is a new ledger entry, not an edit.
  paid: [],
  withheld: ['approved'],
});

export function canTransitionReward(from: RewardState, to: RewardState): boolean {
  return REWARD_TRANSITIONS[from].includes(to);
}

export const RewardLedgerEntrySchema = z.object({
  id: z.string(),
  guideId: z.string(),
  sessionId: z.string().nullable(),
  kind: z.enum(REWARD_KINDS),
  state: z.enum(REWARD_STATES),
  /** Integer minor units + ISO 4217, like every other money column. Null for a
   *  certificate, which is a reward with no amount. */
  amountMinor: z.number().int().nullable(),
  currency: z.string().length(3).nullable(),
  earnedAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
});

export type RewardLedgerEntry = z.infer<typeof RewardLedgerEntrySchema>;
