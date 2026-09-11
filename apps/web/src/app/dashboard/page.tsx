import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert, Card, CardHeader, CompletenessMeter, EmptyState, StatCard } from '@modex/ui';
import type { ProfileCompleteness, StudentProfile } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your dashboard',
  robots: { index: false },
};

interface ProfileResponse {
  profile: StudentProfile;
  completeness: ProfileCompleteness;
}

interface VaultDocument {
  id: string;
  usable: boolean;
}

interface ApplicationSummary {
  id: string;
  state: string;
  nextAction: string | null;
}

/**
 * The student dashboard (Phase 2 design spec).
 *
 * Server-rendered and never cached — `apiGetAs` sets `cache: 'no-store'`, which
 * on an owner-scoped page is the difference between a dashboard and a data
 * breach.
 */
export default async function DashboardPage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/dashboard');

  let data: ProfileResponse;
  let documents: VaultDocument[] = [];
  let applications: ApplicationSummary[] = [];
  try {
    data = await apiGetAs<ProfileResponse>('/me/profile', token);
    documents = (await apiGetAs<{ data: VaultDocument[] }>('/documents', token)).data;
    applications = (await apiGetAs<{ data: ApplicationSummary[] }>('/applications', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/dashboard');
    throw error;
  }

  const usableDocuments = documents.filter((document) => document.usable).length;
  const blockedDocuments = documents.length - usableDocuments;
  const awaitingStudent = applications.filter(
    (application) => application.nextAction !== null,
  ).length;

  return (
    <main className="mx-dashboard">
      <header>
        <h1 className="mx-card__title">Your dashboard</h1>
        <p className="mx-card__description">
          Everything you have told us, and everything still outstanding.
        </p>
      </header>

      {/*
        One brand accent per row at most; the rest are ink. A wall of crimson
        reads as alarm, not as brand.
      */}
      <div className="mx-dashboard__tiles">
        <StatCard
          label="Profile sections complete"
          value={`${data.completeness.completed} of ${data.completeness.total}`}
          caption="Completing more unlocks more eligibility checks"
        />
        <StatCard
          label="Documents ready to use"
          value={usableDocuments}
          caption={
            blockedDocuments === 0
              ? 'All your uploads have been checked'
              : `${blockedDocuments} still need attention`
          }
        />
        <StatCard
          label="Applications"
          value={<Link href="/applications">{applications.length}</Link>}
          caption={
            awaitingStudent === 0
              ? 'Nothing is waiting on you'
              : `${awaitingStudent} waiting on you`
          }
        />
        <StatCard
          label="Conversations"
          value={<Link href="/messages">Your messages</Link>}
          caption="Verified current students, never university staff"
        />
        <StatCard label="Offers" value={0} caption="Offers arrive with Phase 5" />
      </div>

      {blockedDocuments > 0 ? (
        <Alert tone="warning" title="Some documents cannot be used yet">
          {blockedDocuments} of your uploads did not pass our malware check or have not
          finished being checked. Open your <Link href="/documents">document vault</Link> to
          see why.
        </Alert>
      ) : null}

      <div className="mx-dashboard__columns">
        <Card padding="lg">
          <CardHeader
            title="Your profile"
            description="Used to check which published requirements you already meet."
          />
          <div className="mx-dashboard__section">
            <CompletenessMeter
              completeness={data.completeness}
              renderGap={(gap) => <Link href={`/profile#${gap.field}`}>{gap.label}</Link>}
            />
          </div>
        </Card>

        <Card padding="lg">
          <CardHeader
            title="What to do next"
            description="The shortest path to a complete application."
          />
          <div className="mx-dashboard__section">
            {data.completeness.missing.length === 0 &&
            blockedDocuments === 0 &&
            awaitingStudent === 0 ? (
              <EmptyState
                title="Nothing outstanding"
                description="Your profile is complete and every document has been checked. Search for a programme and check your eligibility against it."
              >
                <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
                  Find a programme
                </Link>
              </EmptyState>
            ) : (
              <ol className="mx-dashboard__tasks">
                {data.completeness.missing.slice(0, 3).map((gap) => (
                  <li key={gap.field}>
                    <Link href={`/profile#${gap.field}`}>{gap.label}</Link>
                    <span className="mx-card__description"> — {gap.unlocks}</span>
                  </li>
                ))}
                {awaitingStudent > 0 ? (
                  <li>
                    <Link href="/applications">
                      {awaitingStudent} application(s) need something from you
                    </Link>
                    <span className="mx-card__description">
                      {' '}
                      — an application sitting on your checklist is not being read by anyone
                    </span>
                  </li>
                ) : null}
                {blockedDocuments > 0 ? (
                  <li>
                    <Link href="/documents">Fix {blockedDocuments} document(s)</Link>
                    <span className="mx-card__description">
                      {' '}
                      — a blocked file cannot be sent to a university
                    </span>
                  </li>
                ) : null}
              </ol>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
