import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, CardHeader, EmptyState } from '@modex/ui';
import type { DataCategoryEntry, ErasureDecision } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { PrivacyControls } from '@/components/privacy-controls';

export const metadata: Metadata = {
  title: 'Your data',
  robots: { index: false },
};

interface PrivacyOverview {
  dataMap: DataCategoryEntry[];
  holdings: {
    profile: boolean;
    documents: number;
    applications: { id: string; institution: string; state: string; submittedAt: string | null }[];
    guides: { conversationId: string; institution: string; status: string; since: string }[];
    consents: {
      scope: string;
      grantedAt: string;
      revokedAt: string | null;
      expiresAt: string | null;
      noticeVersion: string;
    }[];
    supportVisits: {
      id: string;
      operatorId: string;
      reason: string;
      reference: string;
      startedAt: string;
      expiresAt: string;
      endedAt: string | null;
    }[];
    payments: number;
  };
  erasurePlan: ErasureDecision[];
}

/**
 * "Who has my data and why" (Phase 7 §2).
 *
 * The acceptance criterion asks for a view *a non-specialist can actually
 * understand*, which rules out the two easy versions: a table of database
 * tables, and a privacy policy. So the page is written the other way round —
 * every row starts from something the student did ("you uploaded three files",
 * "you applied to two universities") and explains who can see it as a
 * consequence.
 *
 * The support-visit list is the one section with no equivalent in a policy
 * document. It says, by name and ticket, every time a Modex operator looked at
 * this account. If nobody has, it says that too, which is the point.
 */
export default async function PrivacyPage() {
  const token = await sessionToken();
  if (token === null) {
    return (
      <main className="mx-page">
        <Alert tone="warning" title="Sign in to see your data">
          This page shows what Modex holds about you. <Link href="/login">Sign in</Link>.
        </Alert>
      </main>
    );
  }

  let overview: PrivacyOverview;
  try {
    overview = await apiGetAs<PrivacyOverview>('/me/privacy', token);
  } catch (error) {
    if (error instanceof ApiError) {
      return (
        <main className="mx-page">
          <Alert tone="warning" title="We could not load your data">
            {error.message}
          </Alert>
        </main>
      );
    }
    throw error;
  }

  const { holdings, dataMap, erasurePlan } = overview;
  const retained = erasurePlan.filter((row) => row.treatment !== 'deleted');

  return (
    <main className="mx-page">
      <h1>Your data</h1>
      <p>
        Everything Modex holds about you, who can reach it, and how long it stays. You can take a
        copy or close your account from the bottom of this page.
      </p>

      <Card padding="lg">
        <CardHeader
          title="What we hold right now"
          description="Counted from your own account, not from a template."
        />
        <ul>
          <li>{holdings.profile ? 'A profile you filled in' : 'No profile yet'}</li>
          <li>
            {holdings.documents === 0
              ? 'No uploaded files'
              : `${holdings.documents} uploaded file${holdings.documents === 1 ? '' : 's'}`}
          </li>
          <li>
            {holdings.applications.length === 0
              ? 'No applications'
              : `${holdings.applications.length} application${holdings.applications.length === 1 ? '' : 's'}: ${holdings.applications
                  .map((row) => `${row.institution} (${row.state.replace(/_/g, ' ')})`)
                  .join(', ')}`}
          </li>
          <li>
            {holdings.guides.length === 0
              ? 'No conversations with student guides'
              : `${holdings.guides.length} conversation${holdings.guides.length === 1 ? '' : 's'} with student guides`}
          </li>
          <li>
            {holdings.payments === 0
              ? 'No payments to Modex'
              : `${holdings.payments} payment record${holdings.payments === 1 ? '' : 's'}`}
          </li>
        </ul>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="When Modex support looked at your account"
          description="A support agent can only see your account if you turn support access on, and only for a short window. Every visit is listed here afterwards."
        />
        {holdings.supportVisits.length === 0 ? (
          <EmptyState
            title="Nobody has viewed your account"
            description="No Modex support agent has opened your account. If one ever does, it appears here with their name, the reason and the ticket."
          />
        ) : (
          <ul>
            {holdings.supportVisits.map((visit) => (
              <li key={visit.id}>
                <strong>{new Date(visit.startedAt).toLocaleString()}</strong> — {visit.reason}{' '}
                (reference {visit.reference}){' '}
                {visit.endedAt === null ? (
                  <Badge tone="warning">In progress</Badge>
                ) : (
                  <Badge tone="neutral">Ended</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="lg">
        <CardHeader
          title="What you have agreed to"
          description="Each of these is separate, and each can be taken back."
        />
        {holdings.consents.length === 0 ? (
          <EmptyState
            title="No consents recorded"
            description="You have not agreed to share anything beyond what running your own account needs."
          />
        ) : (
          <ul>
            {holdings.consents.map((consent) => (
              <li key={`${consent.scope}-${consent.grantedAt}`}>
                {consent.scope.replace(/_/g, ' ')} — agreed{' '}
                {new Date(consent.grantedAt).toLocaleDateString()}{' '}
                {consent.revokedAt === null ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge tone="neutral">Withdrawn</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="lg">
        <CardHeader
          title="Every kind of data, and why we have it"
          description="If something is not on this list, we do not hold it."
        />
        <div style={{ overflowX: 'auto' }}>
          <table className="mx-table">
            <caption className="mx-visually-hidden">
              Data categories, their purpose, who can reach them and how long they are kept
            </caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Why</th>
                <th scope="col">Who can see it</th>
                <th scope="col">How long</th>
              </tr>
            </thead>
            <tbody>
              {dataMap.map((entry) => (
                <tr key={entry.category}>
                  <th scope="row">{entry.label}</th>
                  <td>{entry.purpose}</td>
                  <td>{entry.reachableBy.join('; ')}</td>
                  <td>{entry.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="Take a copy, or close your account"
          description="Closing your account deletes what can be deleted. Some records have to stay, and they are listed before you confirm."
        />
        <PrivacyControls retained={retained.map((row) => ({ explanation: row.explanation }))} />
      </Card>
    </main>
  );
}
