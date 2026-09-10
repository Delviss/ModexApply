import { z } from 'zod';
import { GUIDE_TOPICS } from './guides.js';
import type { GuideState } from './guides.js';

/**
 * Public Q&A (Phase 3 §3).
 *
 * The point of publishing answers is that the thirtieth student asking about
 * accommodation does not need a thirtieth conversation. The cost is that a
 * private answer becomes a public statement, so publication needs **two**
 * independent yeses — a moderator's and the guide's own — and this module is
 * built so that neither can be inferred from the other.
 */

export const QA_STATES = [
  'draft',
  'pending_moderation',
  'published',
  'rejected',
  'withdrawn',
] as const;

export type QaState = (typeof QA_STATES)[number];

export const QuestionSchema = z.object({
  id: z.string(),
  /** Null once published: a question is public, the student who asked is not. */
  askedById: z.string().nullable(),
  institutionId: z.string(),
  programKey: z.string().nullable(),
  topic: z.enum(GUIDE_TOPICS),
  body: z.string().min(10).max(500),
  createdAt: z.iso.datetime(),
});

export type Question = z.infer<typeof QuestionSchema>;

export const AnswerSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  guideId: z.string(),
  body: z.string().min(1).max(4_000),
  state: z.enum(QA_STATES),
  /** Set by a moderator. Necessary for publication, never sufficient. */
  moderatedAt: z.iso.datetime().nullable(),
  moderatedBy: z.string().nullable(),
  /** Set by the guide. Also necessary, also never sufficient. */
  guideConsentedAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  helpfulCount: z.number().int().min(0),
});

export type Answer = z.infer<typeof AnswerSchema>;

/**
 * **The publication predicate.** Fail-closed: it lists what must be true, and a
 * new condition added later blocks publication until it is satisfied.
 *
 * The guide's own state is in here as well as the two consents, because an
 * answer is attributed to a named guide — publishing one from a suspended guide
 * would put a suspended guide's name back on the public site, which is exactly
 * what the suspension removed.
 */
export function canPublishAnswer(
  answer: Pick<Answer, 'state' | 'moderatedAt' | 'guideConsentedAt'>,
  guideState: GuideState,
): boolean {
  return (
    answer.state === 'pending_moderation' &&
    answer.moderatedAt !== null &&
    answer.guideConsentedAt !== null &&
    guideState === 'active'
  );
}

/** Why an answer is not published, for the moderation queue. `null` when it can be. */
export function publicationBlockReason(
  answer: Pick<Answer, 'state' | 'moderatedAt' | 'guideConsentedAt'>,
  guideState: GuideState,
): string | null {
  if (answer.state === 'published') return 'Already published.';
  if (answer.state === 'rejected') return 'This answer was rejected in moderation.';
  if (answer.state === 'withdrawn') return 'The guide withdrew this answer.';
  if (answer.moderatedAt === null) return 'Not moderated yet.';
  if (answer.guideConsentedAt === null) return 'The guide has not agreed to publish this answer.';
  if (guideState !== 'active') return 'The guide is not currently active.';
  return null;
}

/**
 * A published answer, as the public Q&A page sees it.
 *
 * Attribution is the guide's display name and their programme — never their
 * user id, and never anything the directory would not already show.
 */
export const PublishedAnswerSchema = z
  .object({
    id: z.string(),
    questionId: z.string(),
    question: z.string(),
    topic: z.enum(GUIDE_TOPICS),
    institutionId: z.string(),
    institutionName: z.string(),
    programName: z.string().nullable(),
    body: z.string(),
    guideDisplayName: z.string(),
    guideId: z.string(),
    publishedAt: z.iso.datetime(),
    helpfulCount: z.number().int().min(0),
  })
  .strict();

export type PublishedAnswer = z.infer<typeof PublishedAnswerSchema>;

/**
 * The live keyword filter behind the searchable accordion.
 *
 * Deliberately naive substring matching over question, answer and topic: this
 * is a page-local filter over a few dozen answers, not the programme search
 * index, and pretending otherwise would mean two ranking systems to keep
 * honest instead of one.
 */
export function filterAnswers(
  answers: readonly PublishedAnswer[],
  term: string,
): PublishedAnswer[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return [...answers];
  return answers.filter((answer) =>
    [answer.question, answer.body, answer.topic.replace(/_/g, ' ')].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}
