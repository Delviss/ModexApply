import type { Metadata } from 'next';
import { Card, CardHeader, EmptyState, SearchableAccordion } from '@modex/ui';
import { GUIDE_TOPIC_LABELS, type PublishedAnswer } from '@modex/contracts';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Questions students actually asked',
  description:
    'Moderated answers from verified current students about accommodation, costs, coursework and settling in.',
};

/**
 * Public Q&A (Phase 3 §3).
 *
 * Public on purpose: a moderated, attributed answer about what halls cost is
 * exactly what somebody should be able to read before deciding whether this
 * platform is worth an account. Every answer here cleared two independent
 * yeses — a moderator's and the guide's own — and disappears the moment the
 * guide is no longer active.
 */
export default async function QuestionsPage() {
  let answers: PublishedAnswer[] = [];
  let failed = false;
  try {
    answers = (await apiGet<{ data: PublishedAnswer[] }>('/qa')).data;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    failed = true;
  }

  return (
    <main className="mx-qa-page">
      <header>
        <h1 className="mx-card__title">Questions students actually asked</h1>
        <p className="mx-card__description">
          Answered by current students at the university in question, checked by Modex
          before publication, and published only with the student’s agreement.
        </p>
      </header>

      {failed || answers.length === 0 ? (
        <EmptyState
          title={failed ? 'We could not load the answers' : 'No published answers yet'}
          description={
            failed
              ? 'This is our systems, not your question. Try again in a moment.'
              : 'Answers appear here once a guide agrees to publish one and a moderator has checked it.'
          }
        />
      ) : (
        <SearchableAccordion
          label="Search the answers"
          searchPlaceholder="halls, bank account, part-time work…"
          items={answers.map((answer) => ({
            id: answer.id,
            question: `${answer.question} — ${GUIDE_TOPIC_LABELS[answer.topic]}, ${answer.institutionName}`,
            answer: (
              <>
                <p>{answer.body}</p>
                {/*
                  Attribution is the guide's short name and their programme, and
                  nothing the directory would not already show.
                */}
                <p className="mx-card__description">
                  — {answer.guideDisplayName}
                  {answer.programName === null ? '' : `, ${answer.programName}`}, verified
                  current student at {answer.institutionName}
                </p>
              </>
            ),
            searchText: `${answer.question} ${answer.body} ${GUIDE_TOPIC_LABELS[answer.topic]} ${answer.institutionName}`,
          }))}
        />
      )}

      <Card padding="lg">
        <CardHeader
          title="Why these answers are safe to read"
          description="The rules that apply to every guide on Modex."
        />
        <ul className="mx-qa-page__rules">
          <li>Guides are current students whose enrolment we checked and recheck every six months.</li>
          <li>An answer that promises admission or a visa is refused before it is stored.</li>
          <li>No guide is paid for an outcome, and no guide ever takes money from a student.</li>
          <li>Anything here can be reported, and every report opens a case a person reads.</li>
        </ul>
      </Card>
    </main>
  );
}
