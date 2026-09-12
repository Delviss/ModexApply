import { z } from 'zod';

/**
 * Privacy and data governance (Phase 7 §2, TRD §18).
 *
 * The data map lives in code rather than in a document, because a data map in a
 * document is out of date the week after it is written. Every category here is
 * something the platform actually stores, and the student-facing "who has my
 * data and why" view is rendered *from this list* — so adding a table without
 * adding a category is a change that shows up as a gap in a page somebody reads.
 *
 * The hardest thing to get right is erasure. A student has a right to be
 * forgotten; a university has a record of an application it received, and a
 * regulator expects an audit trail of both. Pretending the first overrides the
 * other two would mean promising an erasure that cannot be delivered, so
 * `erasureDecision` states, per category, what is deleted, what is anonymised
 * and what is kept — and why.
 */

export const DATA_CATEGORIES = [
  'identity',
  'contact',
  'profile',
  'academic_history',
  'documents',
  'applications',
  'messages',
  'sessions',
  'consents',
  'payments',
  'trust_reports',
  'support_access',
  'audit',
] as const;

export type DataCategory = (typeof DATA_CATEGORIES)[number];

export type ErasureTreatment =
  /** The row goes. */
  | 'deleted'
  /** The row stays, stripped of anything that identifies a person. */
  | 'anonymised'
  /** Kept in full, under a named obligation, for a stated period. */
  | 'retained';

export interface DataCategoryEntry {
  category: DataCategory;
  /** Plain language. This is what a student reads, not an internal label. */
  label: string;
  /** Why it is collected at all. */
  purpose: string;
  /** Who can reach it, in the student's terms — not a list of role names. */
  reachableBy: string[];
  retention: string;
  erasure: ErasureTreatment;
  /** Present whenever `erasure` is not `deleted`. The obligation, named. */
  erasureReason?: string;
}

export const DATA_MAP: readonly DataCategoryEntry[] = Object.freeze([
  {
    category: 'identity',
    label: 'Your name and date of birth',
    purpose: 'To identify you to a university when you apply, and to nobody else.',
    reachableBy: ['You', 'A university you applied to', 'Modex Trust, during an investigation'],
    retention: 'While your account is open, then seven years if you ever submitted an application.',
    erasure: 'anonymised',
    erasureReason:
      'An application a university received cannot be un-received. The record stays; your name is removed from everything that does not need it.',
  },
  {
    category: 'contact',
    label: 'Your email address and phone number',
    purpose: 'To sign you in and to tell you about your own applications.',
    reachableBy: ['You', 'Modex support, when you ask for help'],
    retention: 'While your account is open.',
    erasure: 'deleted',
  },
  {
    category: 'profile',
    label: 'What you want to study, and where',
    purpose: 'To match you to programmes and to explain why you are or are not eligible.',
    reachableBy: ['You', 'A university you applied to'],
    retention: 'While your account is open.',
    erasure: 'deleted',
  },
  {
    category: 'academic_history',
    label: 'Your qualifications, grades and language tests',
    purpose: 'To check entry requirements before you spend a fee finding out.',
    reachableBy: ['You', 'A university you applied to'],
    retention: 'While your account is open, then with the application if you submitted one.',
    erasure: 'retained',
    erasureReason:
      'A submitted application is a record of what the university was told. Changing it afterwards would falsify their record as well as ours.',
  },
  {
    category: 'documents',
    label: 'Files you uploaded — passports, transcripts, certificates',
    purpose: 'To attach to an application, only when you say so.',
    reachableBy: [
      'You',
      'A university, only for an application you submitted to them',
      'Nobody else — not guides, not other students',
    ],
    retention: 'Per country, configured by market. Seven years by default.',
    erasure: 'deleted',
    erasureReason:
      'The files themselves are deleted. A reference to the file stays on a submitted application so the record of what was sent is not rewritten.',
  },
  {
    category: 'applications',
    label: 'Applications you made, and what happened to them',
    purpose: 'To submit them, to track them, and to show you what was sent.',
    reachableBy: ['You', 'The university you applied to', 'Modex operations, to fix a failure'],
    retention: 'Seven years from submission.',
    erasure: 'anonymised',
    erasureReason: 'Recruitment records are kept under the university’s own obligations.',
  },
  {
    category: 'messages',
    label: 'Conversations with student guides',
    purpose: 'To let you ask a real student what a place is like, safely.',
    reachableBy: ['You', 'The guide you spoke to', 'Modex Trust, if one of you reports the other'],
    retention: 'Two years, or until the conversation is closed and the retention window passes.',
    erasure: 'anonymised',
    erasureReason:
      'The other person’s side of a conversation is their data too, and a message flagged as a scam is evidence.',
  },
  {
    category: 'sessions',
    label: 'Devices you are signed in on',
    purpose: 'To let you see and end your own sign-ins.',
    reachableBy: ['You'],
    retention: 'Until the session expires or you revoke it.',
    erasure: 'deleted',
  },
  {
    category: 'consents',
    label: 'What you agreed to, and when',
    purpose: 'To prove we asked, and to let you take it back.',
    reachableBy: ['You', 'Modex Trust, during an investigation'],
    retention: 'Six years after the consent ends.',
    erasure: 'retained',
    erasureReason:
      'A consent record is the evidence that you were asked. Deleting it would remove the proof that anything was done properly.',
  },
  {
    category: 'payments',
    label: 'Modex service payments and refunds',
    purpose: 'To take payment for Modex’s own services. Tuition is never collected by Modex.',
    reachableBy: ['You', 'Modex finance'],
    retention: 'Seven years.',
    erasure: 'retained',
    erasureReason: 'Financial records are kept under tax and accounting obligations.',
  },
  {
    category: 'trust_reports',
    label: 'Reports you made, and reports about you',
    purpose: 'To investigate scams and to act on them.',
    reachableBy: ['Modex Trust'],
    retention: 'Six years from the case closing.',
    erasure: 'retained',
    erasureReason:
      'A closed case is the record of a decision about somebody’s safety, including possibly somebody else’s.',
  },
  {
    category: 'support_access',
    label: 'Times a Modex support agent viewed your account',
    purpose: 'So you can see what was done, by whom, and why.',
    reachableBy: ['You', 'Modex operations'],
    retention: 'Six years.',
    erasure: 'retained',
    erasureReason: 'This is the record that protects you. It is kept even when everything else goes.',
  },
  {
    category: 'audit',
    label: 'The log of actions taken on your account',
    purpose: 'To reconstruct what happened if something goes wrong.',
    reachableBy: ['Modex Trust and operations', 'A regulator, on request'],
    retention: 'Seven years.',
    erasure: 'retained',
    erasureReason:
      'The audit log is append-only by design. It identifies actions by id rather than by name wherever it can.',
  },
]);

export function dataCategory(category: DataCategory): DataCategoryEntry {
  const entry = DATA_MAP.find((row) => row.category === category);
  if (entry === undefined) throw new Error(`Unmapped data category: ${category}`);
  return entry;
}

/** What an erasure request will actually do, per category. */
export interface ErasureDecision {
  category: DataCategory;
  treatment: ErasureTreatment;
  explanation: string;
}

export function erasurePlan(): ErasureDecision[] {
  return DATA_MAP.map((entry) => ({
    category: entry.category,
    treatment: entry.erasure,
    explanation:
      entry.erasure === 'deleted'
        ? `${entry.label}: deleted.`
        : `${entry.label}: ${entry.erasure}. ${entry.erasureReason ?? ''}`.trim(),
  }));
}

export const ErasureRequestSchema = z.object({
  /**
   * Typed confirmation. An erasure that can be triggered by one misplaced click
   * is a support incident waiting to happen, and the thing being destroyed is
   * not recoverable.
   */
  confirm: z.literal('DELETE MY ACCOUNT'),
  reason: z.string().trim().max(1_000).optional(),
});

export const EXPORT_FORMAT_VERSION = '1.0';

/** Portability: everything the student gave us, in a format they can re-use. */
export const DataExportSchema = z.object({
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  generatedAt: z.iso.datetime(),
  subject: z.object({ userId: z.string(), email: z.string() }),
  categories: z.record(z.string(), z.unknown()),
});

export type DataExport = z.infer<typeof DataExportSchema>;
