import { z } from 'zod';
import { PROGRAM_LEVELS } from './catalogue.js';

/**
 * The Verified Student Guide (Phase 3 §1–§2, FR-007/FR-016).
 *
 * One rule governs every function in this file:
 *
 * > A student guide can help a future student understand a university. They
 * > **cannot** demand tuition, promise admission, guarantee a visa, or claim to
 * > control the university's decision.
 *
 * The parts of that rule which belong to identity live here: a guide exists
 * only as a link to current-student evidence, that evidence expires, and the
 * expiry acts on its own. The parts that belong to what a guide may *say* live
 * in `messaging.ts` and `trust.ts`.
 */

/**
 * Guide lifecycle states.
 *
 * `restricted` and `suspended` are separate on purpose. Restriction is the
 * automatic consequence of lapsed evidence and is undone the moment the guide
 * reverifies; suspension is the consequence of ignoring restriction (or of a
 * trust decision) and needs a human to undo. Collapsing them would mean either
 * that a guide who is a day late loses their conversations, or that a guide who
 * never reverifies keeps them forever.
 */
export const GUIDE_STATES = [
  'pending',
  'active',
  'restricted',
  'suspended',
  'revoked',
] as const;

export type GuideState = (typeof GUIDE_STATES)[number];

/**
 * **The messaging predicate.** Fail-closed by construction: it names the one
 * state that may send rather than listing the states that may not, so a state
 * added later is refused until somebody decides otherwise.
 *
 * Phase 3 acceptance criterion 1 is this function plus the server-side call
 * site in `MessagingService.send`.
 */
export function canGuideSendMessages(state: GuideState): boolean {
  return state === 'active';
}

/** Only an active guide is discoverable. An unverified guide is not listed at all. */
export function isGuideDiscoverable(state: GuideState): boolean {
  return state === 'active';
}

/** Why a guide cannot send, in words the guide reads. `null` when they can. */
export function guideBlockReason(state: GuideState): string | null {
  switch (state) {
    case 'active':
      return null;
    case 'pending':
      return 'Your verification is not finished yet, so you cannot message students. Finish the steps on your dashboard.';
    case 'restricted':
      return 'Your current-student evidence has expired. Reverify to start messaging again — your conversations are still here.';
    case 'suspended':
      return 'Your account is suspended and cannot message students. Modex Trust will be in touch.';
    case 'revoked':
      return 'Your guide account has been withdrawn and cannot message students.';
  }
}

/**
 * Evidence types (Phase 3 §1). Evidence is stored separately from the public
 * record and is never exposed publicly — the same rule as institution evidence
 * in Phase 1 §2. Nothing in `PublicGuideProfile` below can carry one.
 */
export const GUIDE_EVIDENCE_TYPES = [
  'university_domain_email',
  'student_id_document',
  'institution_roster',
] as const;

export type GuideEvidenceType = (typeof GUIDE_EVIDENCE_TYPES)[number];

export const GUIDE_EVIDENCE_LABELS: Readonly<Record<GuideEvidenceType, string>> = Object.freeze({
  university_domain_email: 'University email challenge',
  student_id_document: 'Student ID document',
  institution_roster: 'Institution roster confirmation',
});

/**
 * The verification pipeline (Phase 3 §1): identity → current-student evidence →
 * institution confirmation where available → active. Order is fixed; the only
 * legal move is forward one stage at a time, or out to `failed`.
 */
export const GUIDE_VERIFICATION_STAGES = [
  'identity_check',
  'current_student_evidence',
  'institution_confirmation',
  'active',
] as const;

export type GuideVerificationStage = (typeof GUIDE_VERIFICATION_STAGES)[number];

export const GUIDE_STAGE_LABELS: Readonly<Record<GuideVerificationStage, string>> = Object.freeze({
  identity_check: 'Identity check',
  current_student_evidence: 'Current-student evidence',
  institution_confirmation: 'Institution confirmation',
  active: 'Active guide',
});

/**
 * How long current-student evidence is good for.
 *
 * A student ID scanned in September proves nothing about April, so evidence has
 * a validity period rather than a tick. Six months is one academic semester:
 * long enough that reverification is not busywork, short enough that a guide who
 * graduated or transferred is caught within one term.
 */
export const GUIDE_EVIDENCE_VALIDITY_DAYS = 182;

/** The guide is warned this far ahead of expiry, and the countdown turns amber. */
export const GUIDE_EXPIRY_WARNING_DAYS = 30;

/** The countdown turns red here. Same threshold in the API and the dashboard. */
export const GUIDE_EXPIRY_URGENT_DAYS = 7;

/**
 * How long a restricted guide has to reverify before suspension.
 *
 * Restriction already stops them messaging, so the grace period costs students
 * nothing; it exists so a guide sitting an exam does not lose their standing
 * over a fortnight.
 */
export const GUIDE_SUSPENSION_GRACE_DAYS = 14;

export const GuideVerificationSchema = z.object({
  id: z.string(),
  guideId: z.string(),
  evidenceType: z.enum(GUIDE_EVIDENCE_TYPES),
  /**
   * Pointer to the evidence in secure storage — an object key or a challenge
   * record id. Never the evidence itself, and never selected by a public read.
   */
  evidenceRef: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  reviewerId: z.string().nullable(),
});

export type GuideVerification = z.infer<typeof GuideVerificationSchema>;

export const GUIDE_TOPICS = [
  'accommodation',
  'cost_of_living',
  'campus_life',
  'coursework',
  'teaching_style',
  'part_time_work',
  'arrival_and_settling_in',
  'city_and_transport',
  'societies_and_sport',
  'faith_and_community',
  'family_and_partners',
  'visa_paperwork_experience',
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE_TOPIC_LABELS: Readonly<Record<GuideTopic, string>> = Object.freeze({
  accommodation: 'Accommodation',
  cost_of_living: 'Cost of living',
  campus_life: 'Campus life',
  coursework: 'Coursework and workload',
  teaching_style: 'Teaching style',
  part_time_work: 'Part-time work',
  arrival_and_settling_in: 'Arriving and settling in',
  city_and_transport: 'The city and getting around',
  societies_and_sport: 'Societies and sport',
  faith_and_community: 'Faith and community',
  family_and_partners: 'Bringing family or a partner',
  /**
   * Deliberately "my experience of", not "visa advice". A guide describing the
   * paperwork they filled in is help; a guide advising on an application is the
   * agent behaviour this phase exists to prevent, and the anti-scam rules in
   * `trust.ts` flag any guarantee that comes with it.
   */
  visa_paperwork_experience: 'What the visa paperwork was like for me',
});

/**
 * What a student sees. **This is the whole of what a student sees.**
 *
 * The schema is `.strict()`, so a field added to the internal record does not
 * silently arrive in a student's browser: it fails validation until somebody
 * adds it here on purpose. Phase 3 acceptance criterion 4 — no phone number,
 * email or off-platform handle reachable through a student-facing response — is
 * this shape plus `toPublicGuideProfile` below, and it is tested by feeding a
 * record stuffed with contact details through the projection.
 */
export const PublicGuideProfileSchema = z
  .object({
    id: z.string(),
    /** First name plus last initial. A guide is not a public directory entry. */
    displayName: z.string(),
    avatarRef: z.string().nullable(),
    institutionId: z.string(),
    institutionName: z.string(),
    campusId: z.string().nullable(),
    campusName: z.string().nullable(),
    programKey: z.string().nullable(),
    programName: z.string().nullable(),
    level: z.enum(PROGRAM_LEVELS).nullable(),
    yearOfStudy: z.number().int().min(1).max(10).nullable(),
    languages: z.array(z.string()),
    homeCountry: z.string().nullable(),
    topics: z.array(z.enum(GUIDE_TOPICS)),
    bio: z.string().nullable(),
    state: z.enum(GUIDE_STATES),
    verifiedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    /** Median first reply, in hours. Null until there is anything to average. */
    responseTimeHours: z.number().nullable(),
    /** Seen inside the last five minutes. Never a precise last-seen timestamp. */
    online: z.boolean(),
    /**
     * Tie-break only (Phase 3 §2). It is published so a student can see it, and
     * it is worth `TRUST_SCORE_TIEBREAK` in the ranking — never more.
     */
    trustScore: z.number().min(0).max(100),
    /**
     * True only where the university granted the `guide_programme` scope *and*
     * the staff role explicitly. A guide is never presented as university staff
     * by default.
     */
    universityEndorsed: z.boolean(),
  })
  .strict();

export type PublicGuideProfile = z.infer<typeof PublicGuideProfileSchema>;

/**
 * Everything the platform holds about a guide, including the parts a student
 * must never receive. This type exists so the projection below has something
 * dangerous to project *from* — if the private fields were not modelled, the
 * "no contact details" guarantee would be an accident of which columns the
 * query happened to select.
 */
export interface GuideRecord extends PublicGuideProfile {
  userId: string;
  email: string | null;
  phone: string | null;
  /** WhatsApp, Telegram, Instagram — collected during trust review, never shown. */
  offPlatformHandles: Record<string, string>;
  legalName: string | null;
  evidence: GuideVerification[];
  internalNotes: string | null;
}

/** Keys that must never reach a student client, in one enumerable place. */
export const PRIVATE_GUIDE_KEYS = [
  'userId',
  'email',
  'phone',
  'offPlatformHandles',
  'legalName',
  'evidence',
  'internalNotes',
] as const;

/**
 * The projection every student-facing read goes through.
 *
 * Written as an explicit field list rather than a delete-the-bad-keys loop:
 * omission is the default, so a private field added to `GuideRecord` later is
 * absent from this output because nobody added it, not because somebody
 * remembered to exclude it.
 */
export function toPublicGuideProfile(record: GuideRecord): PublicGuideProfile {
  return {
    id: record.id,
    displayName: record.displayName,
    avatarRef: record.avatarRef,
    institutionId: record.institutionId,
    institutionName: record.institutionName,
    campusId: record.campusId,
    campusName: record.campusName,
    programKey: record.programKey,
    programName: record.programName,
    level: record.level,
    yearOfStudy: record.yearOfStudy,
    languages: record.languages,
    homeCountry: record.homeCountry,
    topics: record.topics,
    bio: record.bio,
    state: record.state,
    verifiedAt: record.verifiedAt,
    expiresAt: record.expiresAt,
    responseTimeHours: record.responseTimeHours,
    online: record.online,
    trustScore: record.trustScore,
    universityEndorsed: record.universityEndorsed,
  };
}

/** First name plus last initial — "Amara O." — never the full legal name. */
export function guideDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return 'Student guide';
  const first = parts[0] ?? 'Student guide';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last === undefined ? first : `${first} ${last.charAt(0).toUpperCase()}.`;
}

// ---------------------------------------------------------------------------
// Expiry lifecycle (Phase 3 §1) — notify → restrict → suspend, no human step
// ---------------------------------------------------------------------------

export const GUIDE_LIFECYCLE_ACTIONS = ['none', 'notify', 'restrict', 'suspend'] as const;
export type GuideLifecycleAction = (typeof GUIDE_LIFECYCLE_ACTIONS)[number];

export interface GuideLifecycleDecision {
  action: GuideLifecycleAction;
  /** The state the guide should hold after the action. */
  nextState: GuideState;
  reason: string;
}

/**
 * What the reverification sweep should do with one guide, right now.
 *
 * Pure and time-injectable, which is what makes the "no human step" acceptance
 * criterion provable: the test moves `now` forward across the thresholds and
 * reads the decisions out, with nothing mocked and nobody clicking anything.
 *
 * `notify` is idempotent by way of `notifiedAt`: the sweep runs hourly and the
 * guide gets one warning, not one per hour.
 */
export function guideLifecycleDecision(
  guide: {
    state: GuideState;
    evidenceExpiresAt: string | Date | null;
    expiryNotifiedAt: string | Date | null;
  },
  now: Date = new Date(),
): GuideLifecycleDecision {
  // Suspension and revocation are terminal for the sweep. A suspended guide is
  // a trust decision; the clock does not get to undo one.
  if (guide.state === 'suspended' || guide.state === 'revoked') {
    return { action: 'none', nextState: guide.state, reason: 'Already out of the directory.' };
  }

  if (guide.evidenceExpiresAt === null) {
    // No evidence, no expiry, no messaging. `pending` is the correct resting
    // state and the sweep leaves it alone.
    return { action: 'none', nextState: guide.state, reason: 'No current-student evidence on file.' };
  }

  const expiresAt = new Date(guide.evidenceExpiresAt);
  const suspendAt = addDays(expiresAt, GUIDE_SUSPENSION_GRACE_DAYS);

  if (now >= suspendAt) {
    return {
      action: 'suspend',
      nextState: 'suspended',
      reason: `Evidence expired more than ${GUIDE_SUSPENSION_GRACE_DAYS} days ago and was not renewed.`,
    };
  }

  if (now >= expiresAt) {
    return guide.state === 'restricted'
      ? { action: 'none', nextState: 'restricted', reason: 'Already restricted; grace period running.' }
      : {
          action: 'restrict',
          nextState: 'restricted',
          reason: 'Current-student evidence has expired.',
        };
  }

  const warnFrom = addDays(expiresAt, -GUIDE_EXPIRY_WARNING_DAYS);
  if (now >= warnFrom && guide.state === 'active' && guide.expiryNotifiedAt === null) {
    return {
      action: 'notify',
      nextState: 'active',
      reason: `Evidence expires within ${GUIDE_EXPIRY_WARNING_DAYS} days.`,
    };
  }

  return { action: 'none', nextState: guide.state, reason: 'Evidence is inside its validity window.' };
}

export type ExpiryUrgency = 'none' | 'due' | 'urgent' | 'lapsed';

/**
 * The dashboard countdown (Phase 3 design spec): amber at 30 days, red at 7.
 * Shared with the API so the badge and the sweep cannot disagree about what
 * "expiring soon" means.
 */
export function guideExpiryUrgency(
  expiresAt: string | Date | null,
  now: Date = new Date(),
): ExpiryUrgency {
  if (expiresAt === null) return 'none';
  const expiry = new Date(expiresAt);
  if (expiry <= now) return 'lapsed';
  const days = (expiry.getTime() - now.getTime()) / 86_400_000;
  if (days <= GUIDE_EXPIRY_URGENT_DAYS) return 'urgent';
  if (days <= GUIDE_EXPIRY_WARNING_DAYS) return 'due';
  return 'none';
}

export function daysUntil(expiresAt: string | Date, now: Date = new Date()): number {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
