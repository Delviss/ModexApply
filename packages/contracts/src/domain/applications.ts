import { z } from 'zod';

/**
 * The application lifecycle (Phase 4 §1, FR-009 and FR-012).
 *
 * One rule governs this whole phase, and it is the reason the state list below
 * is longer than it looks like it needs to be:
 *
 * > A submission is **not** successful because Modex generated a payload. It is
 * > successful only after the university endpoint confirms receipt and returns
 * > a durable reference or equivalent evidence.
 *
 * `submitted_pending` is that rule expressed as a state. It exists so there is
 * somewhere honest to stand between "we sent it" and "they have it", and so
 * that the only way to reach `submitted` is through a stored external
 * reference. A student who believes an application was submitted when it was
 * not has been actively harmed, and every design decision here follows from
 * that.
 */
export const APPLICATION_STATES = [
  'draft',
  'ready',
  'submitted_pending',
  'submitted',
  'failed',
  'under_review',
  'more_info',
  'offer',
  'accepted',
  'declined',
  'rejected',
  'withdrawn',
  'expired',
  'enrolled',
] as const;

export type ApplicationState = (typeof APPLICATION_STATES)[number];

/**
 * The transition table from TRD §8, as data rather than as a switch.
 *
 * Written as an explicit allow-list because the failure this phase fears is a
 * state reached by accident. A state added later has no transitions until
 * somebody writes them here, which is the right default: an unreachable state
 * is a bug report, an unguarded one is a student told the wrong thing.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationState, readonly ApplicationState[]>
> = Object.freeze({
  draft: ['ready', 'withdrawn'],
  ready: ['draft', 'submitted_pending', 'withdrawn'],
  // No path from `submitted_pending` to `ready`: once a payload has left the
  // building, editing the application that produced it would make the snapshot
  // describe something that no longer exists. A failed attempt goes to
  // `failed`, and `failed` is where the student may edit again.
  submitted_pending: ['submitted', 'failed'],
  failed: ['ready', 'withdrawn'],
  submitted: ['under_review', 'offer', 'rejected', 'withdrawn'],
  under_review: ['offer', 'rejected', 'withdrawn', 'more_info'],
  more_info: ['ready', 'withdrawn'],
  offer: ['accepted', 'declined', 'expired'],
  accepted: ['enrolled', 'withdrawn'],
  // Terminal. A reversal is a new application, not an edit of this one.
  declined: [],
  rejected: [],
  withdrawn: [],
  expired: [],
  enrolled: [],
});

/** States from which no transition exists. Useful for the tracker's copy. */
export function isTerminalState(state: ApplicationState): boolean {
  return APPLICATION_TRANSITIONS[state].length === 0;
}

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

/**
 * Who is allowed to *ask* for a transition, on top of it being legal.
 *
 * Legality and authority are separate questions and conflating them is how a
 * student ends up able to mark their own application `offer`. `student` here
 * means the applicant, `university` means an inbound status event or an
 * authorised institution operator, and `system` means the connector pipeline
 * reporting what actually happened.
 */
export const TRANSITION_AUTHORITY: Readonly<
  Record<ApplicationState, readonly ('student' | 'university' | 'system')[]>
> = Object.freeze({
  draft: ['student'],
  ready: ['student', 'system'],
  submitted_pending: ['student', 'system'],
  // A submission is confirmed by evidence, never by optimism: either the
  // pipeline saw a synchronous receipt, or the university sent one as an
  // inbound status event. What stays impossible is the *applicant* declaring
  // it — and `submitted` is reachable only through a stored external
  // reference, which no student can supply.
  submitted: ['system', 'university'],
  // Failure is the pipeline's to report. A university saying no is `rejected`,
  // which is a decision rather than a delivery failure.
  failed: ['system'],
  under_review: ['university', 'system'],
  more_info: ['university', 'system'],
  offer: ['university', 'system'],
  rejected: ['university', 'system'],
  accepted: ['student'],
  declined: ['student'],
  expired: ['system'],
  enrolled: ['university'],
  withdrawn: ['student'],
});

export type TransitionActor = 'student' | 'university' | 'system';

export interface TransitionRefusal {
  code: 'illegal_transition' | 'not_authorised' | 'same_state';
  message: string;
}

/**
 * The single place a transition is decided. Both the service and the tests call
 * this; there is no second copy of the table to drift from.
 */
export function evaluateTransition(
  from: ApplicationState,
  to: ApplicationState,
  actor: TransitionActor,
): TransitionRefusal | null {
  if (from === to) {
    return { code: 'same_state', message: `The application is already ${humanState(from)}.` };
  }
  if (!canTransition(from, to)) {
    return {
      code: 'illegal_transition',
      message: `An application cannot go from ${humanState(from)} to ${humanState(to)}.`,
    };
  }
  if (!TRANSITION_AUTHORITY[to].includes(actor)) {
    return {
      code: 'not_authorised',
      message: `${humanState(to)} is not a state you can set on this application.`,
    };
  }
  return null;
}

/** The state in the words the student is shown, never the enum. */
export function humanState(state: ApplicationState): string {
  switch (state) {
    case 'draft':
      return 'a draft';
    case 'ready':
      return 'ready to submit';
    case 'submitted_pending':
      return 'being sent to the university';
    case 'submitted':
      return 'submitted';
    case 'failed':
      return 'failed to send';
    case 'under_review':
      return 'under review';
    case 'more_info':
      return 'waiting for more information';
    case 'offer':
      return 'holding an offer';
    case 'accepted':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'rejected':
      return 'rejected';
    case 'withdrawn':
      return 'withdrawn';
    case 'expired':
      return 'expired';
    case 'enrolled':
      return 'enrolled';
  }
}

/**
 * The four submission states the design spec insists are visually distinct, and
 * the copy each one is allowed to use.
 *
 * This mapping is the single highest-risk piece of UI in the product, so it is
 * a pure function in the contracts package rather than a set of conditionals in
 * a component: the rule that `submitted_pending` may never render the word
 * "Submitted" is then testable without a browser.
 */
export type SubmissionDisplayState = 'not_submitted' | 'sending' | 'confirmed' | 'failed';

export function submissionDisplayState(state: ApplicationState): SubmissionDisplayState {
  switch (state) {
    case 'draft':
    case 'ready':
      return 'not_submitted';
    case 'submitted_pending':
      return 'sending';
    case 'failed':
      return 'failed';
    default:
      return 'confirmed';
  }
}

/**
 * The sentence shown next to the status, given the state and what we actually
 * know. `externalRef` is threaded through because "Submitted" without the
 * university's own reference is a claim we cannot back.
 */
export function submissionHeadline(
  state: ApplicationState,
  institutionName: string,
  externalRef: string | null,
): string {
  switch (submissionDisplayState(state)) {
    case 'not_submitted':
      return 'Not yet submitted';
    case 'sending':
      return `Sending to ${institutionName}`;
    case 'failed':
      return 'Submission failed';
    case 'confirmed':
      return externalRef === null
        ? `Received by ${institutionName}`
        : `Submitted · confirmed by ${institutionName}`;
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Application tasks drive the student's checklist and the university's queue
 * from the same table (Phase 4 §1). One table rather than two, because the
 * question "who is this waiting on?" has to have exactly one answer.
 */
export const APPLICATION_TASK_TYPES = [
  'complete_profile_field',
  'upload_document',
  'replace_document',
  'accept_consent',
  'answer_question',
  'pay_application_fee',
  'university_review',
  'provide_more_info',
  'operator_submission',
] as const;

export type ApplicationTaskType = (typeof APPLICATION_TASK_TYPES)[number];

export const TASK_OWNERS = ['student', 'university', 'modex_ops'] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];

export const TASK_STATUSES = ['open', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ApplicationTaskSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  owner: z.enum(TASK_OWNERS),
  type: z.enum(APPLICATION_TASK_TYPES),
  title: z.string().min(1),
  /** What to do about it, in the student's words. A task with no remedy is a nag. */
  detail: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  status: z.enum(TASK_STATUSES),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export type ApplicationTask = z.infer<typeof ApplicationTaskSchema>;

// ---------------------------------------------------------------------------
// Snapshots and the canonical payload
// ---------------------------------------------------------------------------

/**
 * Canonical JSON.
 *
 * "The submitted payload can be regenerated from the snapshot and byte-compared
 * against what was sent" is an acceptance criterion, and it is meaningless
 * unless the bytes are a function of the *values* rather than of the order some
 * object literal happened to be written in. So: keys sorted, no insignificant
 * whitespace, `undefined` dropped, arrays left in order because their order is
 * data.
 *
 * Deliberately not `JSON.stringify(value, Object.keys(value).sort())` — that
 * only sorts the top level, and a payload is nested.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value === undefined ? null : value;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value instanceof Date) return value.toISOString();
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) output[key] = canonicalise(entryValue);
  return output;
}

/**
 * A document as it appears in a payload.
 *
 * The checksum is in here on purpose. It is what lets a snapshot prove *which
 * bytes* were sent rather than merely which row was referenced — a distinction
 * that matters the moment anyone asks whether a file was swapped after the
 * fact.
 */
export const SnapshotDocumentSchema = z.object({
  documentId: z.string(),
  versionId: z.string(),
  version: z.number().int().positive(),
  type: z.string(),
  /** SHA-256 of the stored bytes, as recorded when the scan settled. */
  checksum: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  contentType: z.string().nullable(),
});

export type SnapshotDocument = z.infer<typeof SnapshotDocumentSchema>;

/**
 * The frozen payload.
 *
 * Everything the university was sent, and nothing that would let it be
 * recomputed differently later: the profile values are copied rather than
 * referenced, the requirement rows are copied with their versions, and the
 * documents are pinned to exact `DocumentVersion` ids **and** checksums. A
 * student who uploads a better transcript tomorrow changes none of it.
 */
export const ApplicationPayloadSchema = z.object({
  /** Schema version of the payload itself, so a later format change is legible. */
  payloadVersion: z.literal(1),
  application: z.object({
    id: z.string(),
    programKey: z.string(),
    /** The effective-dated programme *version* row, not the stable key. */
    programId: z.string(),
    programVersion: z.number().int().positive(),
    intakeId: z.string(),
    institutionId: z.string(),
  }),
  student: z.object({
    /** Modex's id for the applicant. No email or phone: the connector gets what the university needs. */
    reference: z.string(),
    displayName: z.string(),
    dateOfBirth: z.string().nullable(),
    nationality: z.string().nullable(),
    countryOfResidence: z.string().nullable(),
  }),
  profile: z.object({
    /** Content hash of the profile at submission. The "profile version" FR-011 asks for. */
    profileVersion: z.string(),
    intendedLevel: z.string().nullable(),
    intendedField: z.string().nullable(),
    workExperienceMonths: z.number().int().nonnegative().nullable(),
    academicRecords: z.array(
      z.object({
        level: z.string(),
        institutionName: z.string(),
        countryCode: z.string(),
        fieldOfStudy: z.string(),
        gradeScale: z.string().nullable(),
        gradeValue: z.number().nullable(),
        startedAt: z.string(),
        completedAt: z.string().nullable(),
      }),
    ),
    languageTests: z.array(
      z.object({
        test: z.string(),
        overall: z.number(),
        bands: z.record(z.string(), z.number()),
        takenAt: z.string(),
        expiresAt: z.string().nullable(),
      }),
    ),
  }),
  documents: z.array(SnapshotDocumentSchema),
  /** The rules as they stood at submission, so a later change is provable. */
  requirements: z.array(
    z.object({
      id: z.string(),
      ruleType: z.string(),
      version: z.number().int().positive(),
      humanSummary: z.string(),
    }),
  ),
  consents: z.array(
    z.object({
      scope: z.string(),
      subjectId: z.string().nullable(),
      noticeVersion: z.string(),
      grantedAt: z.string(),
    }),
  ),
  submittedAt: z.string(),
});

export type ApplicationPayload = z.infer<typeof ApplicationPayloadSchema>;

export const ApplicationSnapshotSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  attemptNo: z.number().int().positive(),
  profileVersion: z.string(),
  documentVersionIds: z.array(z.string()),
  payload: ApplicationPayloadSchema,
  payloadHash: z.string(),
  createdAt: z.iso.datetime(),
});

export type ApplicationSnapshot = z.infer<typeof ApplicationSnapshotSchema>;

// ---------------------------------------------------------------------------
// Re-validation at the submission boundary
// ---------------------------------------------------------------------------

/**
 * What the student saw when they marked the application ready.
 *
 * Kept as `(requirementId, version)` pairs rather than as a timestamp, because
 * "did the rules change?" is a question about content and a timestamp only
 * answers "did anything get written?".
 */
export const AcknowledgedRequirementSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  humanSummary: z.string(),
});

export type AcknowledgedRequirement = z.infer<typeof AcknowledgedRequirementSchema>;

export interface RequirementDrift {
  kind: 'added' | 'changed' | 'removed';
  requirementId: string;
  /** The sentence the student needs to read, not the diff. */
  explanation: string;
}

/**
 * Compares what the student agreed to against what the university now asks.
 *
 * A requirement that changed since the student started must **block and
 * explain**, never silently pass. Removals block too, and that is not
 * over-caution: a removed requirement usually means the programme version moved
 * underneath the application, and a payload built against one version and
 * validated against another is precisely the reproducibility hole this phase is
 * about.
 */
export function detectRequirementDrift(
  acknowledged: readonly AcknowledgedRequirement[],
  current: readonly AcknowledgedRequirement[],
): RequirementDrift[] {
  const drift: RequirementDrift[] = [];
  const acknowledgedById = new Map(acknowledged.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));

  for (const requirement of current) {
    const previous = acknowledgedById.get(requirement.id);
    if (previous === undefined) {
      drift.push({
        kind: 'added',
        requirementId: requirement.id,
        explanation: `The university has added a requirement since you started: “${requirement.humanSummary}”. Check you meet it, then mark the application ready again.`,
      });
      continue;
    }
    if (previous.version !== requirement.version) {
      drift.push({
        kind: 'changed',
        requirementId: requirement.id,
        explanation: `A requirement changed since you started. It now reads: “${requirement.humanSummary}”. It previously read: “${previous.humanSummary}”. Check you still meet it, then mark the application ready again.`,
      });
    }
  }

  for (const requirement of acknowledged) {
    if (currentById.has(requirement.id)) continue;
    drift.push({
      kind: 'removed',
      requirementId: requirement.id,
      explanation: `A requirement you were shown — “${requirement.humanSummary}” — is no longer published. The programme has been updated since you started, so we need you to review it before sending anything.`,
    });
  }

  return drift;
}

/**
 * The consents a submission needs, each worded separately.
 *
 * Three, not one. The design rule is "individually checked, separately-worded
 * consents — no single bundled checkbox, no pre-checked boxes", and the reason
 * it is a data structure here rather than markup in a component is that the
 * server checks the same list before it builds a payload. A consent step that
 * the API does not enforce is decoration.
 */
export const SUBMISSION_CONSENTS = Object.freeze([
  Object.freeze({
    id: 'university_submission' as const,
    scope: 'university_submission' as const,
    title: 'Send this application to the university',
    body: 'I ask Modex Apply to send this application to {institution}. Modex Apply is not an agent and cannot influence the decision.',
  }),
  Object.freeze({
    id: 'document_share' as const,
    scope: 'document_share' as const,
    title: 'Share these exact documents',
    body: 'I agree that the {documentCount} document(s) listed above may be sent to {institution}. Documents I upload later are not included.',
  }),
  Object.freeze({
    id: 'decision_contact' as const,
    scope: 'university_submission' as const,
    title: 'Let the university contact me about this application',
    body: '{institution} may contact me directly about this application, including asking for more information.',
  }),
]);

export type SubmissionConsentId = (typeof SUBMISSION_CONSENTS)[number]['id'];

/** Current wording version. Changing any sentence above means bumping this. */
export const SUBMISSION_CONSENT_NOTICE_VERSION = '2026-09-phase4.1';
