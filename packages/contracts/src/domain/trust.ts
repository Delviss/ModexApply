import { z } from 'zod';

/**
 * The anti-scam engine and the trust case (Phase 3 §4, TRD §14, FR-015).
 *
 * This module is the sentence at the top of issue #5 turned into code:
 *
 * > A student guide can help a future student understand a university. They
 * > **cannot** demand tuition, promise admission, guarantee a visa, or claim to
 * > control the university's decision.
 *
 * Four decisions are worth reading before changing anything here.
 *
 * **1. Detection is scoped by who is speaking.** "How do I pay the deposit?" from
 * a student is a question; "send the deposit to my account" from a guide is the
 * thing this phase exists to catch. The same words carry different risk
 * depending on the direction they travel, so `scanMessage` takes the sender's
 * role and the rules declare which roles they apply to. Without that, the
 * engine either misses the guide or buries the trust queue in students asking
 * ordinary questions.
 *
 * **2. Nothing is deleted.** A flag never modifies the message body. The student
 * sees what was said and why it was flagged, because a platform that silently
 * removes a scam attempt teaches nobody what a scam attempt looks like — and
 * because the evidence has to survive the moderation action that acts on it.
 *
 * **3. Normalisation is deliberate but bounded.** Scammers space out words and
 * swap digits for letters, so matching runs against a normalised copy. It is not
 * an arms race we pretend to win in a regex: the rules catch the ordinary case,
 * the report button catches the rest, and `identity_drift` and `message_spam`
 * catch the patterns that no single message reveals.
 *
 * **4. A rule that fires is never the whole decision.** `scanMessage` returns
 * findings and a recommended action; suspending a guide is a separate call,
 * with its own audit event, made by the service.
 */

export const RISK_SIGNALS = [
  'payment_solicitation',
  'guarantee_claim',
  'off_platform_solicitation',
  'identity_drift',
  'message_spam',
  'impersonation',
] as const;

export type RiskSignal = (typeof RISK_SIGNALS)[number];

export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

const SEVERITY_ORDER: Readonly<Record<RiskSeverity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

/** What the pipeline should do with the message it just scanned. */
export const RISK_ACTIONS = ['allow', 'warn', 'warn_and_open_case'] as const;
export type RiskAction = (typeof RISK_ACTIONS)[number];

export interface RiskFinding {
  signal: RiskSignal;
  severity: RiskSeverity;
  /**
   * The exact substrings that matched, preserved for the trust case. Kept short
   * and quoted from the message; the full body is preserved separately and
   * immutably.
   */
  matches: string[];
  /** Shown to the student, above the message, in `--mx-warning`. */
  studentWarning: string;
  /** Shown to the sender when the sender is the one at risk of a suspension. */
  senderNotice: string;
}

export interface RiskAssessment {
  findings: RiskFinding[];
  severity: RiskSeverity | null;
  action: RiskAction;
}

type SenderRole = 'student' | 'guide';

interface RiskRule {
  signal: RiskSignal;
  /** Roles this rule applies to. A rule that applies to nobody is a bug. */
  appliesTo: readonly SenderRole[];
  severity: Readonly<Record<SenderRole, RiskSeverity>>;
  patterns: readonly RegExp[];
  studentWarning: string;
  senderNotice: string;
}

/**
 * Money. The most consequential rule here, so the patterns are phrase-shaped
 * rather than keyword-shaped: `/\bpay\b/` would flag half the catalogue's
 * ordinary questions and train everyone to ignore the warning.
 */
const PAYMENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(send|transfer|wire|pay|deposit)\s*(me|us|it|the\s*(money|fee|amount|deposit))\b/,
  /\b(send|transfer|wire)\s*(the\s*)?(money|funds|fee|fees|cash|deposit|tuition)\b/,
  /\bmy\s+(bank|account|iban|paypal|revolut|wise|venmo|cashapp|wallet)\b/,
  /\b(iban|swift|bic)\s*[:=]?\s*[a-z]{2}\d{2}/,
  /\b(western\s*union|moneygram|cash\s*app|bitcoin|usdt|crypto\s*wallet)\b/,
  /\b(processing|service|agent|handling|admission)\s+fee\s+(of|is|:)?\s*\d/,
  /\bpay\s*(me|us|my|our)\b/,
  /\b(gift\s*card|steam\s*card|itunes\s*card)\b/,
]);

const GUARANTEE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(guarantee|guaranteed|guaranteeing)\b[^.!?]{0,40}\b(admission|admit|place|offer|visa|acceptance|scholarship)\b/,
  /\b(100|hundred)\s*%\s*(admission|acceptance|approval|visa|success)\b/,
  /\bi\s+(can|will)\s+(get|make\s+sure)\s+you\s+(in|admitted|accepted|a\s+place|the\s+visa)\b/,
  /\b(sure|certain|assured)\s+(admission|acceptance|visa)\b/,
  /\b(no|zero)\s+(rejection|refusal)s?\b/,
  /\byour\s+visa\s+is\s+(guaranteed|certain|assured|no\s+problem)\b/,
]);

const OFF_PLATFORM_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(whatsapp|telegram|wechat|viber|signal\s+app|snapchat|imo)\b/,
  /\b(dm|message|text|call|ring)\s+me\s+(on|at|via)\b/,
  /\b(my|this\s+is\s+my)\s+(number|phone|mobile|cell)\b/,
  /\b\+?\d[\d\s().-]{8,}\d\b/,
  /\b[\w.+-]+@(?!modex)[\w-]+\.[a-z]{2,}\b/,
  /\b(here'?s|heres)\s+my\s+(number|email|contact)\b/,
]);

const IMPERSONATION_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bi\s+(am|work)\s+(an?\s+)?(admissions?|enrolment|enrollment)\s+(officer|team|staff|manager|adviser)\b/,
  /\bi\s+work\s+(for|at|in)\s+the\s+(university|admissions?|international)\s+(office|team|department)?\b/,
  /\bi\s+(decide|approve|process|review)\s+(who\s+gets\s+in|the\s+applications?|your\s+application)\b/,
  /\bon\s+behalf\s+of\s+the\s+(university|admissions?\s+office)\b/,
  /\bi\s+am\s+(the\s+)?(university|college)\s+(staff|official|representative|agent)\b/,
]);

const RULES: readonly RiskRule[] = Object.freeze([
  {
    signal: 'payment_solicitation',
    appliesTo: ['guide', 'student'],
    // A guide asking for money is the scam. A student offering it is not a
    // scam, but it is the opening move of one, and warning them is the point.
    severity: { guide: 'critical', student: 'medium' },
    patterns: PAYMENT_PATTERNS,
    studentWarning:
      'This message looks like a request for money. Guides are paid by Modex and never collect tuition, deposits or fees. Do not send money, and report this.',
    senderNotice:
      'This message reads as a request for payment. Guides are never paid by students; asking for money will suspend your account.',
  },
  {
    signal: 'guarantee_claim',
    appliesTo: ['guide'],
    severity: { guide: 'high', student: 'low' },
    patterns: GUARANTEE_PATTERNS,
    studentWarning:
      'This message promises an admission or visa outcome. Nobody — not a guide, not an agent — can guarantee either. Only the university decides admission, and only the government decides a visa.',
    senderNotice:
      'You cannot promise an admission or visa outcome. Describe your own experience instead; repeat claims are escalated to Modex Trust.',
  },
  {
    signal: 'off_platform_solicitation',
    appliesTo: ['guide', 'student'],
    severity: { guide: 'medium', student: 'low' },
    patterns: OFF_PLATFORM_PATTERNS,
    studentWarning:
      'This message tries to move the conversation off Modex, or shares contact details. Off-platform conversations are not checked and cannot be reviewed if something goes wrong.',
    senderNotice:
      'Keep the conversation on Modex. Off-platform messages are not covered by our safety checks, and sharing contact details is logged.',
  },
  {
    signal: 'impersonation',
    appliesTo: ['guide'],
    severity: { guide: 'critical', student: 'low' },
    patterns: IMPERSONATION_PATTERNS,
    studentWarning:
      'This message claims to speak for the university. Guides are current students, not staff, and cannot act on the university’s behalf.',
    senderNotice:
      'You are listed as a current student, not as university staff. Claiming to speak for the university is removed and sent to Modex Trust.',
  },
]);

/**
 * Zero-width characters and the usual letter/digit swaps, removed before
 * matching. Note what is *not* stripped here: `@` and `.` survive, because the
 * off-platform rule needs to see an email address.
 */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  $: 's',
});

export function normaliseForScanning(body: string): string {
  const stripped = body
    .normalize('NFKD')
    // Combining marks and zero-width characters, written as escapes so the
    // source stays readable: "w\u200bh\u200ba\u200bt\u200bs\u200ba\u200bp\u200bp" is one word.
    .replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase();

  // Letters separated by spaces, dots or underscores — "w h a t s a p p",
  // "t.e.l.e.g.r.a.m", "p a y  m e" — are rejoined. Only runs of three or more
  // letters, so "a b" stays two words and ordinary prose is untouched. A run
  // that spans what were several words joins into one, which is why the phrase
  // patterns below tolerate a missing space.
  const rejoined = stripped.replace(/\b(?:[a-z][\s.*_-]+){2,}[a-z]\b/g, (run) =>
    run.replace(/[\s.*_-]/g, ''),
  );

  return rejoined.replace(/[013457$]/g, (character) => CONFUSABLES[character] ?? character);
}

/**
 * Scans one message.
 *
 * Pure and synchronous: it runs inline on the send path, before the message is
 * stored, so a flagged message is stored *already flagged* rather than being
 * written clean and corrected by a job that might not run.
 */
export function scanMessage(body: string, sender: SenderRole): RiskAssessment {
  // Digits are matched against the original too: normalisation maps 0→o, which
  // would erase the phone number the off-platform rule is looking for.
  const normalised = normaliseForScanning(body);
  const raw = body.toLowerCase();
  const findings: RiskFinding[] = [];

  for (const rule of RULES) {
    if (!rule.appliesTo.includes(sender)) continue;
    const matches = new Set<string>();
    for (const pattern of rule.patterns) {
      for (const candidate of [normalised, raw]) {
        const match = pattern.exec(candidate);
        if (match !== null) matches.add(match[0].trim().slice(0, 120));
      }
    }
    if (matches.size === 0) continue;
    findings.push({
      signal: rule.signal,
      severity: rule.severity[sender],
      matches: [...matches],
      studentWarning: rule.studentWarning,
      senderNotice: rule.senderNotice,
    });
  }

  const severity = highestSeverity(findings);
  return { findings, severity, action: actionFor(severity) };
}

export function highestSeverity(findings: readonly RiskFinding[]): RiskSeverity | null {
  return findings.reduce<RiskSeverity | null>(
    (worst, finding) =>
      worst === null || SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[worst]
        ? finding.severity
        : worst,
    null,
  );
}

/**
 * Severity → action.
 *
 * `medium` and above opens a trust case. A `low` finding warns in-thread and is
 * logged but does not summon a human: a student typing their own email address
 * is worth a nudge, not a case file.
 */
export function actionFor(severity: RiskSeverity | null): RiskAction {
  if (severity === null) return 'allow';
  return severity === 'low' ? 'warn' : 'warn_and_open_case';
}

/** The one-line summary stored on the message and shown above it. */
export function flagSummary(assessment: RiskAssessment): string | null {
  if (assessment.findings.length === 0) return null;
  return assessment.findings.map((finding) => finding.studentWarning).join(' ');
}

// ---------------------------------------------------------------------------
// Rate limiting — the signal no single message carries (TRD §14)
// ---------------------------------------------------------------------------

/** Outbound messages per guide per hour before the queue-for-review rule fires. */
export const GUIDE_MESSAGE_RATE_PER_HOUR = 60;

/** Distinct students per guide per hour. Broadcast spam looks like this. */
export const GUIDE_DISTINCT_RECIPIENTS_PER_HOUR = 20;

export function exceedsMessageRate(counts: {
  messagesLastHour: number;
  distinctRecipientsLastHour: number;
}): boolean {
  return (
    counts.messagesLastHour > GUIDE_MESSAGE_RATE_PER_HOUR ||
    counts.distinctRecipientsLastHour > GUIDE_DISTINCT_RECIPIENTS_PER_HOUR
  );
}

/**
 * Identity drift (TRD §14): a guide who keeps changing which university or
 * programme they study forces reverification.
 *
 * Two changes is a correction; three is a pattern. The window is deliberately
 * long — a scammer rotating institutions does it over months, not hours.
 */
export const IDENTITY_DRIFT_THRESHOLD = 3;
export const IDENTITY_DRIFT_WINDOW_DAYS = 180;

export function requiresReverificationForDrift(
  changes: readonly { changedAt: string | Date }[],
  now: Date = new Date(),
): boolean {
  const cutoff = new Date(now.getTime() - IDENTITY_DRIFT_WINDOW_DAYS * 86_400_000);
  return changes.filter((change) => new Date(change.changedAt) >= cutoff).length >= IDENTITY_DRIFT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Trust cases (FR-015) — any user can report any person, offer, claim or message
// ---------------------------------------------------------------------------

export const TRUST_CASE_TYPES = [
  'payment_solicitation',
  'guarantee_claim',
  'off_platform_contact',
  'impersonation',
  'identity_drift',
  'spam',
  'harassment',
  'fraudulent_offer',
  'false_institution_claim',
  'other',
] as const;

export type TrustCaseType = (typeof TRUST_CASE_TYPES)[number];

/**
 * What can be reported. FR-015 says "a person, offer, institutional claim or
 * message" and this list is exactly that, plus `program` — because a student
 * who spots a wrong tuition figure should not have to decide whether that is an
 * "institutional claim".
 */
export const REPORTABLE_TARGET_TYPES = [
  'guide',
  'message',
  'conversation',
  'offer',
  'institution',
  'program',
  'user',
] as const;

export type ReportableTargetType = (typeof REPORTABLE_TARGET_TYPES)[number];

export const TRUST_CASE_STATES = [
  'open',
  'triaging',
  'evidence_preserved',
  'actioned',
  'dismissed',
  'escalated',
] as const;

export type TrustCaseState = (typeof TRUST_CASE_STATES)[number];

/**
 * Legal transitions. `dismissed` and `actioned` are terminal: reopening is a new
 * case, so the record of what was decided and when cannot be rewritten.
 */
const CASE_TRANSITIONS: Readonly<Record<TrustCaseState, readonly TrustCaseState[]>> = Object.freeze({
  open: ['triaging', 'evidence_preserved', 'dismissed', 'escalated'],
  triaging: ['evidence_preserved', 'actioned', 'dismissed', 'escalated'],
  evidence_preserved: ['actioned', 'dismissed', 'escalated'],
  actioned: [],
  dismissed: [],
  escalated: ['actioned', 'dismissed'],
});

export function canTransitionCase(from: TrustCaseState, to: TrustCaseState): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export const TrustCaseSchema = z.object({
  id: z.string(),
  type: z.enum(TRUST_CASE_TYPES),
  /** Null when the platform opened the case itself, from a risk rule. */
  reporterId: z.string().nullable(),
  targetType: z.enum(REPORTABLE_TARGET_TYPES),
  targetId: z.string(),
  state: z.enum(TRUST_CASE_STATES),
  severity: z.enum(RISK_SEVERITIES),
  summary: z.string(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});

export type TrustCase = z.infer<typeof TrustCaseSchema>;

export const ReportSchema = z.object({
  targetType: z.enum(REPORTABLE_TARGET_TYPES),
  targetId: z.string().min(1),
  type: z.enum(TRUST_CASE_TYPES),
  /** What the reporter saw, in their words. Mandatory — a report with no
   *  description is a report nobody can act on. */
  description: z.string().trim().min(10, 'Tell us what happened, in a sentence or two.').max(2_000),
});

export type ReportInput = z.infer<typeof ReportSchema>;

/** Risk signal → case type, so an automatic case is filed the same way a human one is. */
export const SIGNAL_CASE_TYPE: Readonly<Record<RiskSignal, TrustCaseType>> = Object.freeze({
  payment_solicitation: 'payment_solicitation',
  guarantee_claim: 'guarantee_claim',
  off_platform_solicitation: 'off_platform_contact',
  impersonation: 'impersonation',
  identity_drift: 'identity_drift',
  message_spam: 'spam',
});

/**
 * Severity at which a guide is suspended immediately rather than reviewed.
 *
 * Only `critical` — a payment demand or an impersonated admissions officer.
 * Everything below waits for a human, because suspending a real student over a
 * regex is its own kind of harm.
 */
export function suspendsImmediately(severity: RiskSeverity | null): boolean {
  return severity === 'critical';
}
