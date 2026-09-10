import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Card, CardHeader, EmptyState, GuideCard } from '@modex/ui';
import { GUIDE_TOPICS, GUIDE_TOPIC_LABELS, type MatchFactor, type PublicGuideProfile } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Student guides',
  description: 'Verified current students who answer questions about their own university.',
  robots: { index: false },
};

interface DirectoryResponse {
  data: { guide: PublicGuideProfile; matchReason: string; factors: MatchFactor[] }[];
}

/**
 * The guide directory (Phase 3 §2).
 *
 * Signed-in only, and deliberately so. The catalogue is public because a
 * programme is a published fact; a guide is a person, and a directory of
 * identifiable current students indexed by search engines is not something we
 * should ship because it happened to be easier.
 *
 * Ordering comes from the API's weighted rules, and the "why you are seeing
 * this guide" line on each card is built from the factors that actually scored.
 */
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/guides');

  const params = await searchParams;
  const institutionId = typeof params.institutionId === 'string' ? params.institutionId : null;
  const topic = typeof params.topic === 'string' ? params.topic : null;

  if (institutionId === null) {
    return (
      <main className="mx-guides-page">
        <header>
          <h1 className="mx-card__title">Student guides</h1>
          <p className="mx-card__description">
            Guides answer questions about the university they actually attend, so start
            from a university.
          </p>
        </header>
        <EmptyState
          title="Pick a university first"
          description="Open any university page and use “Ask a student who is there” — we only ever show you guides from that university, because that is the only thing they can speak to."
        >
          <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
            Browse programmes
          </Link>
        </EmptyState>
      </main>
    );
  }

  let response: DirectoryResponse | null = null;
  let failed = false;
  try {
    const query = new URLSearchParams({ institutionId });
    if (topic !== null) query.set('topics', topic);
    response = await apiGetAs<DirectoryResponse>(`/guides?${query.toString()}`, token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/guides');
    if (!(error instanceof ApiError)) throw error;
    failed = true;
  }

  const guides = response?.data ?? [];

  return (
    <main className="mx-guides-page">
      <header>
        <h1 className="mx-card__title">Student guides</h1>
        <p className="mx-card__description">
          Every guide here is a current student whose enrolment Modex has checked, and
          rechecks every six months. Guides are never university staff, never collect
          money, and cannot influence an admission decision.
        </p>
      </header>

      <nav className="mx-guides-page__topics" aria-label="Filter by topic">
        <Link
          href={`/guides?institutionId=${encodeURIComponent(institutionId)}`}
          data-selected={topic === null}
        >
          Everything
        </Link>
        {GUIDE_TOPICS.map((entry) => (
          <Link
            key={entry}
            href={`/guides?institutionId=${encodeURIComponent(institutionId)}&topic=${entry}`}
            data-selected={topic === entry}
          >
            {GUIDE_TOPIC_LABELS[entry]}
          </Link>
        ))}
      </nav>

      {failed ? (
        <Alert tone="danger" title="We could not load the guides">
          This is our systems, not your account. Try again in a moment.
        </Alert>
      ) : guides.length === 0 ? (
        <EmptyState
          title="No guides here yet"
          description="Nobody at this university has been verified as a guide yet, or none of them matched the topic you picked. The public questions and answers may already cover what you need."
        >
          <Link className="mx-button" data-variant="secondary" data-size="md" href="/questions">
            Read answers from students
          </Link>
        </EmptyState>
      ) : (
        <div className="mx-guides-page__grid">
          {guides.map(({ guide, matchReason }) => (
            <GuideCard
              key={guide.id}
              guide={guide}
              matchReason={matchReason}
              action={
                <Link
                  className="mx-button"
                  data-variant="primary"
                  data-size="sm"
                  href={`/guides/${guide.id}`}
                >
                  See their profile
                </Link>
              }
            />
          ))}
        </div>
      )}

      <Card padding="lg">
        <CardHeader
          title="What a guide is, and is not"
          description="The same rules the platform enforces, in plain words."
        />
        <ul className="mx-guides-page__rules">
          <li>They are current students, verified by Modex — not university staff.</li>
          <li>They never collect tuition, deposits or application fees. Nobody legitimate will ask.</li>
          <li>They cannot guarantee admission or a visa, and nor can anyone else.</li>
          <li>They are paid by Modex for their time, never by you, and never for an outcome.</li>
        </ul>
      </Card>
    </main>
  );
}
