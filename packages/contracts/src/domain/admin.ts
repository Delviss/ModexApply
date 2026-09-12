import { z } from 'zod';
import type { Role } from './access.js';

/**
 * The four admin consoles (Phase 6, #8).
 *
 * One shell, four workspaces, one permission model. The rules that keep them
 * apart are here rather than in the API, because every one of them is a rule
 * the web shell also has to render — a disabled approve button with the reason
 * shown, a step-up interstitial, an impersonation banner — and a rule written
 * twice is a rule that will disagree with itself.
 *
 * Three decisions are worth reading before changing anything in this file.
 *
 * **1. A console is a view, not a role.** `university`, `trust`, `operations`
 * and `finance` are surfaces over the same RBAC table. Nobody gets access
 * because they opened a URL; `consolesFor` only decides what to *render*.
 *
 * **2. Elevation expires.** Step-up authentication and support impersonation
 * are both time-boxed, and both compare against a clock rather than a flag. A
 * boolean that is set once and never cleared is how "temporary" access becomes
 * permanent.
 *
 * **3. Two actors means two people.** `assertDualApproval` is the only place
 * that decides whether a payout may be approved, and it refuses the initiator
 * by identity — not by role, not by a UI state the client could lie about.
 */

export const CONSOLES = ['university', 'trust', 'operations', 'finance'] as const;
export type Console = (typeof CONSOLES)[number];

/**
 * Which consoles a set of roles may see.
 *
 * `superadmin` sees all four. Everyone else sees exactly the one they work in:
 * a trust agent has no business in the finance console, and hiding it is not
 * security — the permission check is — but a console full of buttons that all
 * fail is worse than no console.
 */
const CONSOLE_ROLES: Readonly<Record<Console, readonly Role[]>> = Object.freeze({
  university: ['university_admin', 'university_staff', 'superadmin'],
  trust: ['trust_agent', 'superadmin'],
  operations: ['ops', 'superadmin'],
  finance: ['finance', 'superadmin'],
});

export function consolesFor(roles: readonly Role[]): Console[] {
  return CONSOLES.filter((console) =>
    CONSOLE_ROLES[console].some((role) => roles.includes(role)),
  );
}

// ---------------------------------------------------------------------------
// Step-up authentication
// ---------------------------------------------------------------------------

/**
 * A second factor, re-presented, for entering a console and again for the two
 * actions inside it that cannot be undone by an apology: viewing verification
 * evidence, and sanctioning someone.
 *
 * MFA at sign-in proves who started the session hours ago. Step-up proves who
 * is at the keyboard now, which is the question an unattended laptop asks.
 */
export const STEP_UP_ACTIONS = [
  'console_entry',
  'evidence_view',
  'sanction',
  'impersonation',
  'payout_approval',
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

/** Fifteen minutes: long enough to work a queue, short enough to expire over lunch. */
export const STEP_UP_TTL_MINUTES = 15;

export function isStepUpFresh(
  stepUpAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (stepUpAt === null) return false;
  const at = new Date(stepUpAt).getTime();
  if (Number.isNaN(at)) return false;
  // A step-up stamped in the future is a clock problem or a forged value, and
  // either way it is not evidence that somebody just authenticated.
  if (at > now.getTime()) return false;
  return now.getTime() - at <= STEP_UP_TTL_MINUTES * 60_000;
}

export function stepUpExpiresAt(stepUpAt: Date | string): string {
  return new Date(new Date(stepUpAt).getTime() + STEP_UP_TTL_MINUTES * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Support impersonation (operations console)
// ---------------------------------------------------------------------------

/**
 * Controlled, time-boxed, consented, and always audited.
 *
 * The student sees it happened: a grant is readable by its subject, which is
 * why the "who has my data" view in Phase 7 reads this table too.
 */
export const IMPERSONATION_MAX_MINUTES = 30;

export const ImpersonationRequestSchema = z.object({
  subjectId: z.string().min(1),
  /** Why. Free text, mandatory, and it lands in the audit event verbatim. */
  reason: z.string().trim().min(10, 'Say why you need to see this account.').max(500),
  /** The support ticket or trust case this is being done for. */
  reference: z.string().trim().min(1).max(120),
  minutes: z.number().int().min(1).max(IMPERSONATION_MAX_MINUTES).default(15),
});

export type ImpersonationRequest = z.infer<typeof ImpersonationRequestSchema>;

export function isImpersonationActive(
  grant: { startedAt: Date | string; expiresAt: Date | string; endedAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (grant.endedAt !== null) return false;
  const started = new Date(grant.startedAt).getTime();
  const expires = new Date(grant.expiresAt).getTime();
  return started <= now.getTime() && now.getTime() < expires;
}

// ---------------------------------------------------------------------------
// Sanctions (trust console)
// ---------------------------------------------------------------------------

export const SANCTION_KINDS = ['warn', 'restrict', 'suspend', 'ban'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export const SANCTION_TARGET_TYPES = ['guide', 'user', 'offer', 'institution'] as const;
export type SanctionTargetType = (typeof SANCTION_TARGET_TYPES)[number];

/**
 * Reason codes, not free text.
 *
 * Free text cannot be counted, cannot be appealed against consistently, and
 * cannot answer "how many people did we suspend for this last quarter". The
 * free-text `reason` is kept as well, for the human reading the case.
 */
export const SANCTION_REASON_CODES = [
  'payment_solicitation',
  'guarantee_claim',
  'impersonation',
  'off_platform_contact',
  'spam',
  'harassment',
  'identity_unverified',
  'identity_drift',
  'fraudulent_offer',
  'false_institution_claim',
  'repeat_violation',
  'other',
] as const;

export type SanctionReasonCode = (typeof SANCTION_REASON_CODES)[number];

export const SanctionSchema = z.object({
  targetType: z.enum(SANCTION_TARGET_TYPES),
  targetId: z.string().min(1),
  kind: z.enum(SANCTION_KINDS),
  reasonCode: z.enum(SANCTION_REASON_CODES),
  reason: z.string().trim().min(10, 'A sanction needs a reason somebody can read.').max(2_000),
  /** The trust case this came out of, when there is one. */
  caseId: z.string().nullable().default(null),
  /** Null is permanent. Only `warn` and `restrict` are expected to carry one. */
  expiresAt: z.iso.datetime().nullable().default(null),
});

export type SanctionInput = z.infer<typeof SanctionSchema>;

export const SanctionReversalSchema = z.object({
  reason: z.string().trim().min(10, 'Say why this is being lifted.').max(2_000),
});

/**
 * Every sanction has a reversal path — including `ban`.
 *
 * A platform that can suspend someone but cannot un-suspend them has built a
 * one-way door with no handle on the inside, which is how a false positive
 * becomes permanent. Reversal is a new row's worth of audit, never a delete.
 */
export function canReverse(sanction: { reversedAt: Date | string | null }): boolean {
  return sanction.reversedAt === null;
}

/** Sanctions that take a guide out of the directory and out of messaging. */
export function silencesGuide(kind: SanctionKind): boolean {
  return kind === 'suspend' || kind === 'ban';
}

// ---------------------------------------------------------------------------
// Requirement review (university portal)
// ---------------------------------------------------------------------------

export const REQUIREMENT_DECISIONS = ['approved', 'overridden', 'annotated'] as const;
export type RequirementDecision = (typeof REQUIREMENT_DECISIONS)[number];

export const RequirementReviewSchema = z.object({
  decision: z.enum(REQUIREMENT_DECISIONS),
  reason: z.string().trim().min(10, 'Every review needs a reason.').max(2_000),
  /** Present only for `overridden`: the machine rule the university wants instead. */
  ruleJson: z.unknown().optional(),
  /** Present for `overridden` and `annotated`: the human summary students read. */
  humanSummary: z.string().trim().min(10).max(1_000).optional(),
});

export type RequirementReviewInput = z.infer<typeof RequirementReviewSchema>;

/**
 * An override that changes nothing is not an override.
 *
 * Catching it here rather than at write time keeps a no-op out of the audit
 * trail, where it would dilute exactly the events a regulator reads first.
 */
export function describesChange(input: RequirementReviewInput): boolean {
  if (input.decision === 'approved') return true;
  return input.ruleJson !== undefined || input.humanSummary !== undefined;
}

// ---------------------------------------------------------------------------
// Finance — dual approval
// ---------------------------------------------------------------------------

export const PAYOUT_STATES = ['pending_approval', 'approved', 'rejected', 'paid'] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

/**
 * Above this, one person cannot both start and finish a payout.
 *
 * Stated per currency in minor units, because "500" means two different amounts
 * in GBP and JPY and a single number would silently mean the wrong one. An
 * unlisted currency falls back to the strictest threshold rather than the
 * loosest: an unconfigured currency should be harder to pay out, not easier.
 */
export const HIGH_VALUE_PAYOUT_THRESHOLD_MINOR: Readonly<Record<string, number>> = Object.freeze({
  GBP: 20_000,
  EUR: 25_000,
  USD: 25_000,
});

const STRICTEST_THRESHOLD_MINOR = 0;

export function highValueThresholdFor(currency: string): number {
  return HIGH_VALUE_PAYOUT_THRESHOLD_MINOR[currency.toUpperCase()] ?? STRICTEST_THRESHOLD_MINOR;
}

export function requiresDualApproval(amountMinor: number, currency: string): boolean {
  return amountMinor >= highValueThresholdFor(currency);
}

export interface DualApprovalCheck {
  ok: boolean;
  /** Rendered on the disabled button, so the actor is told why, not just refused. */
  reason: string | null;
}

export function checkDualApproval(payout: {
  amountMinor: number;
  currency: string;
  initiatedBy: string;
  approverId: string;
}): DualApprovalCheck {
  if (!requiresDualApproval(payout.amountMinor, payout.currency)) {
    return { ok: true, reason: null };
  }
  if (payout.initiatedBy === payout.approverId) {
    return {
      ok: false,
      reason: 'Awaiting approval by someone other than you — you initiated this payout.',
    };
  }
  return { ok: true, reason: null };
}

export const REFUND_REASON_CODES = [
  'duplicate_charge',
  'service_not_delivered',
  'student_withdrew',
  'pricing_error',
  'goodwill',
  'chargeback',
] as const;

export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const RefundSchema = z.object({
  transactionId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  reasonCode: z.enum(REFUND_REASON_CODES),
  reason: z.string().trim().min(10).max(1_000),
});

/**
 * Tuition is not collected by Modex (TRD §15). Only Modex's own service
 * payments can be refunded, and this is the list of what those are — a refund
 * against a tuition reference would be refunding money we never held.
 */
export const TRANSACTION_KINDS = ['service_payment', 'service_refund', 'guide_payout'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export function isRefundable(kind: TransactionKind): boolean {
  return kind === 'service_payment';
}

// ---------------------------------------------------------------------------
// Operations — connector health
// ---------------------------------------------------------------------------

export const CONNECTOR_HEALTH_STATES = ['healthy', 'degraded', 'failing', 'idle'] as const;
export type ConnectorHealthState = (typeof CONNECTOR_HEALTH_STATES)[number];

export interface ConnectorHealthInput {
  attempts: number;
  succeeded: number;
  deadLettered: number;
  p95LatencyMs: number | null;
}

/**
 * Health from the last window of attempts.
 *
 * `idle` is its own state rather than a green "healthy": a connector that has
 * handled nothing is not working, it is untested, and showing it green is how
 * a partner outage goes unnoticed for a week.
 */
export function connectorHealth(input: ConnectorHealthInput): ConnectorHealthState {
  if (input.attempts === 0) return 'idle';
  if (input.deadLettered > 0) return 'failing';
  const rate = input.succeeded / input.attempts;
  if (rate >= 0.95) return 'healthy';
  if (rate >= 0.8) return 'degraded';
  return 'failing';
}

/** An application stuck this long past its last attempt is an exception, not a wait. */
export const SUBMISSION_STUCK_AFTER_MINUTES = 60;

export function isSubmissionStuck(
  application: { state: string; updatedAt: Date | string },
  now: Date = new Date(),
): boolean {
  if (application.state !== 'submitted_pending') return false;
  const since = now.getTime() - new Date(application.updatedAt).getTime();
  return since > SUBMISSION_STUCK_AFTER_MINUTES * 60_000;
}

// ---------------------------------------------------------------------------
// Operations — notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATES = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'suppressed',
] as const;

export type NotificationDeliveryState = (typeof NOTIFICATION_DELIVERY_STATES)[number];

export const NotificationTemplateSchema = z.object({
  key: z.string().trim().min(3).max(120),
  channel: z.enum(NOTIFICATION_CHANNELS),
  locale: z.string().trim().min(2).max(10).default('en'),
  subject: z.string().trim().max(200).nullable().default(null),
  body: z.string().trim().min(1).max(20_000),
});

export type NotificationTemplateInput = z.infer<typeof NotificationTemplateSchema>;

/**
 * Template placeholders are `{{name}}`, and only names that appear on this list
 * are allowed. A template is content an operator edits at runtime; without an
 * allow-list, "edit the welcome email" is an arbitrary read of whatever the
 * render context happens to hold.
 */
export const TEMPLATE_PLACEHOLDERS = [
  'studentName',
  'guideName',
  'institutionName',
  'programName',
  'applicationRef',
  'deadline',
  'supportUrl',
] as const;

export function unknownPlaceholders(body: string): string[] {
  const found = [...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1] ?? '');
  const allowed = new Set<string>(TEMPLATE_PLACEHOLDERS);
  return [...new Set(found.filter((name) => !allowed.has(name)))];
}

// ---------------------------------------------------------------------------
// Portal access
// ---------------------------------------------------------------------------

/**
 * No unverified domain, no portal.
 *
 * The institution's official domain is what ties the person clicking "publish"
 * to the university whose name is on the programme. An institution that has not
 * proved its domain gets no workspace, no matter what roles its staff hold.
 */
export function canAccessUniversityPortal(institution: {
  verificationState: string;
  domainConfirmedAt: Date | string | null;
}): boolean {
  return institution.domainConfirmedAt !== null && institution.verificationState === 'verified';
}

export const PORTAL_BLOCKED_MESSAGE =
  'This institution has not completed official-domain verification. The portal opens once the domain is confirmed.';
