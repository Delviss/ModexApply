import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  ExpiryCountdown,
  StatCard,
  TaskSteps,
  type TaskStep,
} from '@modex/ui';
import {
  GUIDE_STAGE_LABELS,
  type GuideState,
  type GuideVerificationStage,
  type PublicGuideProfile,
} from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your guide dashboard',
  robots: { index: false, follow: false },
};

interface DashboardResponse {
  profile: PublicGuideProfile;
  verification: {
    stage: GuideVerificationStage;
    state: GuideState;
    pipeline: { stage: GuideVerificationStage; status: 'pending' | 'active' | 'done' | 'error' }[];
    evidence: { id: string; evidenceType: string; summary: string; expiresAt: string | null }[];
    expiresAt: string | null;
    expiryUrgency: 'none' | 'due' | 'urgent' | 'lapsed';
    daysRemaining: number | null;
    suspensionReason: string | null;
  };
  upcomingSessions: { id: string; scheduledFor: string; channel: string; status: string }[];
  rewards: { id: string; state: string; amountMinor: number | null; currency: string | null }[];
  openConversations: number;
}

/**
 * The guide's own dashboard (Phase 3 design spec).
 *
 * The verification card is first and the countdown is in it, because the single
 * thing a guide most needs to know is how long their standing lasts and what
 * happens when it runs out. The same thresholds drive the colour here and the
 * job that acts on them, so this page cannot say "plenty of time" while a sweep
 * restricts the account that evening.
 */
export default async function GuideDashboardPage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/guide/dashboard');

  let data: DashboardResponse;
  try {
    data = await apiGetAs<DashboardResponse>('/guides/me/dashboard', token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/guide/dashboard');
    // 404 is "no guide profile"; 403 is "signed in, but not a guide at all".
    // Both mean the same thing to the person reading the page, and neither is
    // an error worth a stack trace.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return (
        <main className="mx-guide-dashboard">
          <EmptyState
            title="You are not registered as a guide"
            description="Guides are current students verified by Modex, and a university has to run a guide programme before its students can join one."
          >
            <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
              Browse programmes
            </Link>
          </EmptyState>
        </main>
      );
    }
    throw error;
  }

  const steps: TaskStep[] = data.verification.pipeline.map((entry) => ({
    id: entry.stage,
    title: GUIDE_STAGE_LABELS[entry.stage],
    status: entry.status,
  }));

  const paid = data.rewards
    .filter((entry) => entry.state === 'earned' || entry.state === 'approved' || entry.state === 'paid')
    .reduce((total, entry) => total + (entry.amountMinor ?? 0), 0);

  return (
    <main className="mx-guide-dashboard">
      <header>
        <h1 className="mx-card__title">Your guide dashboard</h1>
        <p className="mx-card__description">
          You are listed at {data.profile.institutionName}. Students see your first name
          and last initial — never your email, phone number or full name.
        </p>
      </header>

      {data.verification.state === 'suspended' ? (
        <Alert tone="danger" title="Your account is suspended">
          {data.verification.suspensionReason ??
            'Modex Trust is reviewing your account. You cannot message students while this is open.'}
        </Alert>
      ) : data.verification.state === 'restricted' ? (
        <Alert tone="warning" title="Messaging is paused">
          Your current-student evidence has expired. Reverify and it comes back
          immediately — your conversations are still here.
        </Alert>
      ) : null}

      <div className="mx-dashboard__tiles">
        <StatCard label="Open conversations" value={data.openConversations} />
        <StatCard label="Upcoming sessions" value={data.upcomingSessions.length} />
        <StatCard
          label="Reward balance"
          value={paid === 0 ? '—' : `£${(paid / 100).toFixed(2)}`}
          caption="Paid by Modex for sessions you delivered. Never tied to whether a student got in."
        />
        <StatCard
          label="Usual reply time"
          value={
            data.profile.responseTimeHours === null
              ? '—'
              : `${Math.round(data.profile.responseTimeHours)}h`
          }
        />
      </div>

      <div className="mx-dashboard__columns">
        <Card padding="lg">
          <CardHeader
            title="Your verification"
            description="Modex checks that you are a current student, and rechecks it every six months."
          />
          <TaskSteps steps={steps} />
          <ExpiryCountdown expiresAt={data.verification.expiresAt} />
          <p className="mx-card__description">
            We remind you 30 days before, pause messaging the day it lapses, and suspend
            the account two weeks after that if it has not been renewed. None of that
            needs anybody at Modex to do anything.
          </p>
        </Card>

        <Card padding="lg">
          <CardHeader title="Upcoming sessions" />
          {data.upcomingSessions.length === 0 ? (
            <EmptyState
              title="Nothing booked"
              description="Add times you are free and students can book one. You are paid for the time you give, whatever happens to their application."
            />
          ) : (
            <ul className="mx-guide-dashboard__sessions">
              {data.upcomingSessions.map((session) => (
                <li key={session.id}>
                  <time dateTime={session.scheduledFor}>
                    {new Date(session.scheduledFor).toLocaleString('en-GB')}
                  </time>
                  <span className="mx-card__description"> · {session.channel}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
