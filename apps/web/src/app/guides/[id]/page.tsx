import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Badge, Card, CardHeader, SafetyBanner, VerificationBadge } from '@modex/ui';
import { GUIDE_TOPIC_LABELS, type PublicGuideProfile } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { StartConversation } from '@/components/start-conversation';
import { BookSession, type BookableSlotPayload } from '@/components/book-session';

export const metadata: Metadata = {
  // A guide is a person, not a catalogue entry. Nothing about them is indexed.
  title: 'Student guide',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * One guide's profile (Phase 3 design spec).
 *
 * The order on the page is the argument: who they are, what Modex checked, what
 * they can help with — and only then the two actions. The safety rules are
 * above the actions rather than below them, because a warning under a button is
 * a warning read after the click.
 */
export default async function GuidePage({ params }: PageProps) {
  const token = await sessionToken();
  const { id } = await params;
  if (token === null) redirect(`/login?next=/guides/${id}`);

  let guide: PublicGuideProfile;
  let slots: BookableSlotPayload[] = [];
  try {
    guide = (await apiGetAs<{ guide: PublicGuideProfile }>(`/guides/${encodeURIComponent(id)}`, token))
      .guide;
    slots = (
      await apiGetAs<{ data: BookableSlotPayload[] }>(
        `/guides/${encodeURIComponent(id)}/availability`,
        token,
      )
    ).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401) redirect(`/login?next=/guides/${id}`);
    throw error;
  }

  return (
    <main className="mx-guide-page">
      <header className="mx-guide-page__header">
        <div>
          <h1 className="mx-card__title">{guide.displayName}</h1>
          <p className="mx-card__description">
            {[guide.programName, guide.campusName, guide.institutionName]
              .filter((part) => part !== null)
              .join(' · ')}
            {guide.yearOfStudy === null ? '' : ` · Year ${guide.yearOfStudy}`}
          </p>
        </div>
        <VerificationBadge
          variant="full"
          claim={{
            objectType: 'guide',
            objectId: guide.id,
            state: guide.state === 'active' ? 'verified' : 'unverified',
            verifierName: 'Modex Trust',
            verifierType: 'trust_agent',
            verifiedAt: guide.verifiedAt,
            expiresAt: guide.expiresAt,
            evidenceSummary:
              'Current-student enrolment confirmed with the university and rechecked every six months. The evidence itself is never published.',
          }}
        />
      </header>

      <SafetyBanner />

      <div className="mx-guide-page__columns">
        <div className="mx-guide-page__main">
          {guide.bio === null ? null : (
            <Card padding="lg">
              <CardHeader title="In their words" />
              <p>{guide.bio}</p>
            </Card>
          )}

          <Card padding="lg">
            <CardHeader
              title="What they can talk about"
              description="Guides answer from their own experience. They do not give admissions or visa advice."
            />
            <ul className="mx-guide-page__topics">
              {guide.topics.map((topic) => (
                <li key={topic}>
                  <Badge tone="neutral">{GUIDE_TOPIC_LABELS[topic]}</Badge>
                </li>
              ))}
            </ul>
            {guide.languages.length === 0 ? null : (
              <p className="mx-card__description">Speaks {guide.languages.join(', ')}.</p>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader
              title="Book a call"
              description="Sessions are arranged and hosted by Modex. There is no payment of any kind between you and a guide."
            />
            <BookSession guideId={guide.id} slots={slots} />
          </Card>
        </div>

        <aside className="mx-guide-page__aside">
          <Card padding="lg">
            <CardHeader title="Start a conversation" />
            <StartConversation
              guideId={guide.id}
              guideName={guide.displayName}
              contextType="institution"
              contextId={guide.institutionId}
            />
          </Card>
        </aside>
      </div>
    </main>
  );
}
