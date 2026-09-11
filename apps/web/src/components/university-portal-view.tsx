'use client';

import { Alert, Badge, Card, CardHeader, DataTable, EmptyState, StatCard } from '@modex/ui';
import { ConsoleShell } from './console-shell';
import { ConsoleAction } from './console-chrome';
import type { ConsoleSession } from '@/lib/console';

interface Dashboard {
  institutionId: string;
  applications: { total: number; byState: Record<string, number> };
  funnel: { stage: string; count: number }[];
  conversion: { submittedToOffer: number | null; offerToEnrolment: number | null };
  offers: Record<string, number>;
  guides: { total: number; active: number };
  catalogue: { published: number; stale: number };
}

interface ApplicationRow {
  id: string;
  state: string;
  programKey: string;
  currentOwner: string;
  externalRef: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  operatorAssisted: boolean;
  student: { id: string; displayName: string };
  intake: { id: string; startDate: string; applicationDeadline: string };
  latestAttempt: { state: string; failureCode: string | null } | null;
}

interface GuideRow {
  id: string;
  state: string;
  stage: string;
  programKey: string | null;
  verifiedAt: string | null;
  evidenceExpiresAt: string | null;
  universityEndorsed: boolean;
}

export interface UniversityPortalData {
  dashboard: Dashboard;
  applications: ApplicationRow[];
  guides: GuideRow[];
}

/**
 * The university portal's view (FR-017).
 *
 * Client-side for the same reason as every other console view: the tables take
 * render functions. The data arrives already scoped to this institution by the
 * API; nothing here re-filters, because a filter on the client is not a
 * boundary.
 */
export function UniversityPortalView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: UniversityPortalData;
}) {
  return (
    <ConsoleShell
      session={session}
      current="university"
      title="University portal"
      sections={[
        { id: 'overview', label: 'Overview', href: '/admin/university', current: true },
        { id: 'catalogue', label: 'Catalogue', href: '/admin/catalogue' },
        { id: 'offers', label: 'Offers', href: '/admin/offers' },
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          }}
        >
          <StatCard label="Applications" value={data.dashboard.applications.total} />
          <StatCard
            label="Submitted → offer"
            value={
              data.dashboard.conversion.submittedToOffer === null
                ? '—'
                : `${data.dashboard.conversion.submittedToOffer}%`
            }
            caption="Of applications that reached you"
          />
          <StatCard
            label="Offer → enrolment"
            value={
              data.dashboard.conversion.offerToEnrolment === null
                ? '—'
                : `${data.dashboard.conversion.offerToEnrolment}%`
            }
          />
          <StatCard label="Guides active" value={data.dashboard.guides.active} />
          <StatCard
            label="Catalogue needs re-confirming"
            value={data.dashboard.catalogue.stale}
            trend={
              data.dashboard.catalogue.stale > 0
                ? { direction: 'up', label: 'hidden from students', isGood: false }
                : undefined
            }
            caption={
              data.dashboard.catalogue.stale > 0
                ? 'A stale price or deadline hides the record'
                : undefined
            }
          />
        </section>

        <Card padding="lg">
          <CardHeader
            title="Funnel"
            description="Cumulative: an enrolled application also reached offer and review. A funnel that grows at the bottom is a funnel counting each state on its own."
          />
          <DataTable
            className="mx-console-table"
            rows={data.dashboard.funnel}
            rowId={(row) => row.stage}
            caption="Applications by funnel stage"
            columns={[
              { id: 'stage', header: 'Stage', value: (row) => row.stage },
              { id: 'count', header: 'Reached', value: (row) => row.count },
            ]}
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Applications"
            description="Status updates go through the application state machine. An application only reads “submitted” once you have given a reference."
          />
          <DataTable
            className="mx-console-table"
            rows={data.applications}
            rowId={(row) => row.id}
            caption="Inbound applications"
            searchPlaceholder="Search by programme or applicant"
            columns={[
              { id: 'student', header: 'Applicant', value: (row) => row.student.displayName },
              { id: 'programme', header: 'Programme', value: (row) => row.programKey, sortable: true },
              {
                id: 'state',
                header: 'State',
                value: (row) => row.state,
                sortable: true,
                render: (row) => (
                  <span>
                    <Badge
                      tone={
                        row.state === 'failed'
                          ? 'danger'
                          : row.state === 'submitted_pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {row.state.replace(/_/g, ' ')}
                    </Badge>
                    {row.operatorAssisted ? <Badge tone="info">operator-assisted</Badge> : null}
                  </span>
                ),
              },
              {
                id: 'reference',
                header: 'Your reference',
                value: (row) => row.externalRef ?? '',
                render: (row) =>
                  row.externalRef === null ? (
                    <span style={{ color: 'var(--mx-text-muted)' }}>Not yet given</span>
                  ) : (
                    <code style={{ fontSize: 'var(--mx-text-xs)' }}>{row.externalRef}</code>
                  ),
              },
              {
                id: 'owner',
                header: 'Waiting on',
                value: (row) => row.currentOwner,
                sortable: true,
              },
              {
                id: 'actions',
                header: 'Move to',
                value: (row) => row.id,
                render: (row) => (
                  <span style={{ display: 'inline-flex', gap: 'var(--mx-space-2)' }}>
                    <ConsoleAction
                      path={`/admin/university/applications/${row.id}/state`}
                      body={{ state: 'under_review' }}
                      label="Under review"
                      disabledReason={
                        row.state === 'submitted' ? null : 'Only a submitted application can move to review.'
                      }
                    />
                    <ConsoleAction
                      path={`/admin/university/applications/${row.id}/state`}
                      body={{ state: 'offer' }}
                      label="Offer"
                      variant="primary"
                      disabledReason={
                        row.state === 'under_review' ? null : 'Move it to review first.'
                      }
                    />
                  </span>
                ),
              },
            ]}
            empty={
              <EmptyState
                title="No applications yet"
                description="Applications appear here the moment a student submits, before you have given a reference."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Guides"
            description="Your student guides. Endorsement says they are one of your students; verification is Modex Trust’s, and stays that way."
          />
          <DataTable
            className="mx-console-table"
            rows={data.guides}
            rowId={(row) => row.id}
            caption="Guide roster"
            columns={[
              {
                id: 'state',
                header: 'State',
                value: (row) => row.state,
                sortable: true,
                render: (row) => (
                  <Badge
                    tone={
                      row.state === 'active'
                        ? 'success'
                        : row.state === 'suspended'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {row.state}
                  </Badge>
                ),
              },
              { id: 'programme', header: 'Programme', value: (row) => row.programKey ?? '—' },
              {
                id: 'expiry',
                header: 'Evidence expires',
                value: (row) => row.evidenceExpiresAt ?? '',
                sortable: true,
                render: (row) =>
                  row.evidenceExpiresAt === null
                    ? '—'
                    : new Date(row.evidenceExpiresAt).toLocaleDateString(),
              },
              {
                id: 'endorsed',
                header: 'Endorsement',
                value: (row) => String(row.universityEndorsed),
                render: (row) => (
                  <ConsoleAction
                    path={`/admin/university/guides/${row.id}/endorsement`}
                    body={{ endorsed: !row.universityEndorsed }}
                    label={row.universityEndorsed ? 'Withdraw endorsement' : 'Endorse'}
                  />
                ),
              },
            ]}
            empty={
              <EmptyState
                title="No guides yet"
                description="Students at your institution can apply to become guides; Modex Trust verifies them."
              />
            }
          />
        </Card>

        <Alert tone="info" title="What this portal cannot do">
          It cannot verify a guide, publish an unverified offer, or see another institution’s data.
          Each of those is refused server-side and recorded, whatever this page renders.
        </Alert>
      </div>
    </ConsoleShell>
  );
}
