import { z } from 'zod';
import { isConnectorEligible, type DocumentType, type DocumentVersion } from './documents.js';

/**
 * Document assessment — the human read of a student's file.
 *
 * The malware scan in `documents.ts` answers "are these bytes safe to move".
 * This file answers a different question that nobody had written down: **is
 * this document the document it claims to be, and is it usable in support of
 * an application?** A clean scan on a photograph of a desk is still a clean
 * scan.
 *
 * Four rules shape everything below, and each of them exists because the
 * obvious shortcut is worse:
 *
 * **1. An unscanned file is never opened for assessment.** `canAssess` is the
 * gate, and it is expressed as "the connector predicate must already pass"
 * rather than as its own list of acceptable scan states. One predicate, one
 * answer: a reviewer must never be the person who finds the malware.
 *
 * **2. A rejection always names a reason a student can act on.** The reason
 * codes are a closed set with student-facing text attached, because "rejected"
 * with a free-text note that says "wrong" is a support ticket, not a decision.
 *
 * **3. An assessment is about the document, never about the applicant.** There
 * is no score, no rating, no field anywhere in this file that could be summed
 * into an admission likelihood — the same product boundary the eligibility
 * engine holds.
 *
 * **4. A decision is attached to an exact version.** Assessing "the transcript"
 * would silently carry a verdict across a re-upload, which is precisely how a
 * rejected file becomes an accepted one without anybody looking at it.
 */

/**
 * What a reviewer can conclude.
 *
 * `more_information` is separate from `rejected` on purpose: a legible document
 * that is simply missing a page is not a failed document, and telling a student
 * it was rejected sends them off to find a replacement they do not need.
 */
export const ASSESSMENT_DECISIONS = ['accepted', 'more_information', 'rejected'] as const;
export type AssessmentDecision = (typeof ASSESSMENT_DECISIONS)[number];

/**
 * Where a document sits in the queue.
 *
 * `awaiting_scan` is a state of the *queue*, not of a decision: it is how the
 * console shows a file that has arrived but that no reviewer may open yet.
 */
export const ASSESSMENT_STATES = [
  'awaiting_scan',
  'awaiting_review',
  'in_review',
  'accepted',
  'more_information',
  'rejected',
] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

/**
 * The closed set of reasons a document can be turned back, each with the
 * sentence the student actually reads.
 *
 * Free text is still allowed *in addition* — a reviewer often knows something
 * specific — but never *instead*. A student who is told "page 2 is missing"
 * knows what to do; a student who is told "rejected" writes in and asks.
 */
export const ASSESSMENT_REASONS = [
  'illegible',
  'incomplete',
  'wrong_document',
  'expired',
  'untranslated',
  'uncertified',
  'mismatched_identity',
  'suspected_alteration',
] as const;
export type AssessmentReason = (typeof ASSESSMENT_REASONS)[number];

export const ASSESSMENT_REASON_TEXT: Readonly<Record<AssessmentReason, string>> = Object.freeze({
  illegible: 'We could not read this clearly enough. Upload a sharper scan or photo of the whole page.',
  incomplete: 'Pages are missing. Upload every page of the document, including the back where it is printed.',
  wrong_document: 'This is not the document this slot asks for. Check the document type and upload again.',
  expired: 'This document has expired. Upload a current one.',
  untranslated:
    'This is not in English and no certified translation is attached. Upload the original and its certified translation.',
  uncertified:
    'This copy is not certified. Universities ask for a certified copy of this document; your institution or a notary can provide one.',
  mismatched_identity:
    'The name on this document does not match the name on your profile. If you changed your name, upload the evidence of the change as well.',
  suspected_alteration:
    'We could not accept this file as it stands. Please upload the original document, unedited, straight from its source.',
});

/**
 * Reasons that open a trust case rather than simply bouncing the file back.
 *
 * Only one, and deliberately: a suspected alteration is an allegation about a
 * person, and it belongs in front of Trust with its evidence rather than in a
 * reviewer's private note. Everything else on the list is a bad scan.
 */
export const TRUST_ESCALATING_REASONS: readonly AssessmentReason[] = Object.freeze([
  'suspected_alteration',
]);

export const DocumentAssessmentSchema = z.object({
  id: z.string(),
  /** The exact version assessed. A re-upload is a new version and a new decision. */
  documentVersionId: z.string(),
  documentId: z.string(),
  studentId: z.string(),
  type: z.string(),
  /** Null for a platform-wide review; set when one institution asked for it. */
  institutionId: z.string().nullable(),
  /** The application the document was attached to, when it was attached to one. */
  applicationId: z.string().nullable(),
  state: z.enum(ASSESSMENT_STATES),
  decision: z.enum(ASSESSMENT_DECISIONS).nullable(),
  reasons: z.array(z.enum(ASSESSMENT_REASONS)),
  /** The reviewer's own words, on top of the reason codes. Never instead of them. */
  note: z.string().nullable(),
  reviewerId: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type DocumentAssessment = z.infer<typeof DocumentAssessmentSchema>;

export const AssessmentDecisionSchema = z
  .object({
    decision: z.enum(ASSESSMENT_DECISIONS),
    reasons: z.array(z.enum(ASSESSMENT_REASONS)).default([]),
    note: z.string().trim().max(2000).nullable().default(null),
  })
  .refine((input) => input.decision === 'accepted' || input.reasons.length > 0, {
    message: 'A decision that is not an acceptance has to name at least one reason.',
    path: ['reasons'],
  });

export type AssessmentDecisionInput = z.infer<typeof AssessmentDecisionSchema>;

/**
 * **The review gate.** A reviewer may open a version only once the scan has
 * cleared it and its bytes are known to have landed.
 *
 * Expressed through `isConnectorEligible` rather than as its own state list:
 * the set of things safe to hand to a university and the set of things safe to
 * open in a console are the same set, and writing it twice is how they stop
 * being the same set.
 */
export function canAssess(version: DocumentVersion): boolean {
  return isConnectorEligible(version);
}

/** Why a version cannot be opened for review yet. `null` when it can. */
export function assessmentBlockReason(version: DocumentVersion): string | null {
  if (canAssess(version)) return null;
  if (version.scanState === 'quarantined') {
    return 'Quarantined by the malware scan. Nobody opens this file; the student uploads a clean copy.';
  }
  if (version.scanState === 'pending') return 'Still being scanned. It cannot be opened yet.';
  if (version.scanState === 'failed') return 'The scan could not finish, so this file stays closed.';
  return 'This upload did not finish, so there is nothing complete to review.';
}

/**
 * The state a queue row is in, derived rather than stored.
 *
 * Derived because the scan runs asynchronously and can land after the row does:
 * a stored `awaiting_review` written at upload time would be a lie for however
 * long the scan takes, and the console would offer a button that refuses.
 */
export function assessmentState(
  version: Pick<DocumentVersion, 'scanState' | 'uploadComplete' | 'checksum'>,
  assessment: Pick<DocumentAssessment, 'decision' | 'startedAt'> | null,
): AssessmentState {
  if (!canAssess(version as DocumentVersion)) return 'awaiting_scan';
  if (assessment?.decision != null) return assessment.decision;
  return assessment?.startedAt != null ? 'in_review' : 'awaiting_review';
}

/**
 * Whether a decision leaves the document usable in a submission.
 *
 * Only an acceptance does. An undecided document is *not* blocked — assessment
 * is a service to the student, not a gate the platform puts in front of their
 * own application — which is why this asks about decisions rather than about
 * the absence of one.
 */
export function blocksSubmission(assessment: DocumentAssessment | null): boolean {
  return assessment?.decision === 'rejected' || assessment?.decision === 'more_information';
}

/** The sentences a student is shown for a decision, in order. */
export function decisionText(assessment: DocumentAssessment): string[] {
  const reasons = assessment.reasons.map((reason) => ASSESSMENT_REASON_TEXT[reason]);
  if (assessment.note !== null && assessment.note.trim() !== '') reasons.push(assessment.note.trim());
  return reasons;
}

/** Does this decision belong in front of Trust rather than only in the vault? */
export function escalatesToTrust(input: Pick<DocumentAssessment, 'reasons'>): boolean {
  return input.reasons.some((reason) => TRUST_ESCALATING_REASONS.includes(reason));
}

/**
 * How long a queue row may sit before the console calls it late.
 *
 * One number, in one place, because it is quoted to students ("we look at
 * documents within two working days") and shown to reviewers as an SLA. Two
 * copies of it would eventually disagree, and the student's copy is the one
 * that would be wrong.
 */
export const ASSESSMENT_SLA_HOURS = 48;

export function isOverdue(row: { createdAt: string; decidedAt: string | null }, now: Date = new Date()): boolean {
  if (row.decidedAt !== null) return false;
  const age = now.getTime() - new Date(row.createdAt).getTime();
  return age > ASSESSMENT_SLA_HOURS * 3_600_000;
}

/**
 * The document types every application needs before a reviewer can say the
 * pack is complete. Programme-specific extras come from the requirement rules;
 * these three are the floor, and a pack missing one of them is incomplete
 * whatever else it contains.
 */
export const CORE_DOCUMENT_TYPES: readonly DocumentType[] = Object.freeze([
  'passport',
  'transcript',
  'language_test',
]);

export function missingCoreTypes(present: readonly DocumentType[]): DocumentType[] {
  return CORE_DOCUMENT_TYPES.filter((type) => !present.includes(type));
}
