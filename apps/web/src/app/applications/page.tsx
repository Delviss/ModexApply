import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState } from '@modex/ui';
import {
  submissionDisplayState,
  type ApplicationState,
  type ConnectorType,
} from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Your applications',
  robots: { index: false },
};

interface ApplicationRow {
  id: string;
  state: ApplicationState;
  headline: string;
  programKey: string;
  programName: string;
  institution: { id: string; displayName: string; country: string };
  intake: { id: string; startDate: string; applicationDeadline: string; status: string };
  connectorType: ConnectorType | null;
  externalRef: string | null;
  operatorAssisted: boolean;
  nextAction: string | null;
  openTasks: number;
  updatedAt: string;
}

/**
 * The applications overview.
 *
 * Owner-scoped and server-rendered with `apiGetAs`, which sets
 * `cache: 'no-store'` — Next's data cache is keyed on the URL, not the session,
 * so a cached `/v1/applications` would serve one student's applications to the
 * next student who asked.
 *
 * The status column uses `submissionDisplayState` rather than the raw state, so
 * a `submitted_pending` row cannot read "Submitted" here either. The rule holds
 * on every surface or it holds on none.
 */
export default async function ApplicationsPage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/applications');

  let applications: ApplicationRow[];
  try {
    applications = (await apiGetAs<{ data: ApplicationRow[] }>('/applications', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/applications');
    throw error;
  }

  return (
    <main className="mx-applications">
      <header>
        <h1 className="mx-card__title">Your applications</h1>
        <p className="mx-card__description">
          Every application you have started, what state it is in, and what is waiting on you.
        </p>
      </header>

      {applications.length === 0 ? (
        <EmptyState
          title="You have not started an application yet"
          description="Find a programme you are eligible for, check what it asks for, and start from its page. Nothing is sent to a university until you say so."
        >
          <Link className="mx-button" data-variant="primary" data-size="md" href="/programmes">
            Find a programme
          </Link>
        </EmptyState>
      ) : (
        <Card padding="lg">
          <CardHeader
            title={`${applications.length} application${applications.length === 1 ? '' : 's'}`}
            description="Ordered by what changed most recently."
          />
          <div className="mx-applications__scroll">
            <table className="mx-table">
              <caption className="mx-visually-hidden">
                Your applications, with the university, status, deadline and next action
              </caption>
              <thead>
                <tr>
                  <th scope="col">Programme</th>
                  <th scope="col">University</th>
                  <th scope="col">Status</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id}>
                    <th scope="row">
                      <Link href={`/applications/${application.id}`}>
                        {application.programName}
                      </Link>
                    </th>
                    <td>{application.institution.displayName}</td>
                    <td>
                      <Badge tone={TONES[submissionDisplayState(application.state)]}>
                        {application.headline}
                      </Badge>
                      {application.operatorAssisted ? (
                        <span className="mx-applications__operator">
                          Submitted by Modex staff on your behalf
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <time dateTime={application.intake.applicationDeadline}>
                        {new Date(application.intake.applicationDeadline).toLocaleDateString(
                          'en-GB',
                          { year: 'numeric', month: 'short', day: 'numeric' },
                        )}
                      </time>
                    </td>
                    <td>
                      {application.nextAction ?? (
                        <span className="mx-card__description">Nothing waiting on you</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}

const TONES = {
  not_submitted: 'neutral',
  sending: 'info',
  confirmed: 'success',
  failed: 'danger',
} as const;
