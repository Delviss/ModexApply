'use client';

import { Badge, Card, CardHeader, DataTable, EmptyState, StatCard } from '@modex/ui';
import { ConsoleShell } from './console-shell';
import { ConsoleAction, ConsoleImpersonationBanner } from './console-chrome';
import type { ConsoleSession } from '@/lib/console';

interface ConnectorRow {
  connectorId: string;
  institution: string;
  type: string;
  displayName: string;
  enabled: boolean;
  health: 'healthy' | 'degraded' | 'failing' | 'idle';
  attempts: number;
  succeeded: number;
  deadLettered: number;
  retries: number;
  successRate: number | null;
  p95LatencyMs: number | null;
  failureCodes: { code: string; count: number }[];
  lastPolledAt: string | null;
}

interface Exceptions {
  stuckPending: {
    applicationId: string;
    institution: string;
    waitingSince: string;
    hasReference: boolean;
    remediation: string;
  }[];
  failed: {
    applicationId: string;
    institution: string;
    failureCode: string | null;
    failureReason: string | null;
    remediation: string;
  }[];
  deadLettered: {
    id: string;
    applicationId: string;
    attemptNo: number;
    failureCode: string | null;
    remediation: string;
  }[];
}

interface Catalogue {
  stale: { programmes: number; fees: number };
  pendingImports: number;
  failingRuns: number;
  runs: {
    id: string;
    institution: string;
    trigger: string;
    status: string;
    startedAt: string;
    recordsSeen: number;
    recordsChanged: number;
    recordsFailed: number;
    error: string | null;
    durationMs: number | null;
  }[];
}

interface Impersonation {
  id: string;
  operatorId: string;
  subjectId: string;
  reason: string;
  reference: string;
  startedAt: string;
  expiresAt: string;
}

const HEALTH_TONE: Record<ConnectorRow['health'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success',
  degraded: 'warning',
  failing: 'danger',
  // Not green. A connector that has handled nothing is untested, not working,
  // and a green badge on it is how a partner outage goes unnoticed for a week.
  idle: 'neutral',
};

export interface OpsConsoleData {
  connectors: ConnectorRow[];
  exceptions: Exceptions;
  catalogue: Catalogue;
  impersonations: Impersonation[];
}

/**
 * The operations console's view (Phase 6 §3).
 *
 * Every exception row carries its remediation text from the API rather than
 * deriving one here — the operator reading it at three in the morning and the
 * runbook in `docs/` should not be able to disagree.
 */
export function OpsConsoleView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: OpsConsoleData;
}) {
  const exceptionCount =
    data.exceptions.stuckPending.length +
    data.exceptions.failed.length +
    data.exceptions.deadLettered.length;

  return (
    <ConsoleShell
      session={session}
      current="operations"
      title="Operations console"
      banner={
        session.impersonatedBy === null ? undefined : (
          <ConsoleImpersonationBanner
            operator={session.impersonatedBy}
            subject={session.userId}
            expiresAt={new Date(Date.now() + 15 * 60_000).toISOString()}
          />
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          }}
        >
          <StatCard label="Open exceptions" value={exceptionCount} />
          <StatCard
            label="Connectors failing"
            value={data.connectors.filter((row) => row.health === 'failing').length}
          />
          <StatCard label="Stale catalogue records" value={data.catalogue.stale.programmes} />
          <StatCard label="Imports awaiting commit" value={data.catalogue.pendingImports} />
          <StatCard label="Support sessions open" value={data.impersonations.length} />
        </section>

        <Card padding="lg">
          <CardHeader
            title="Connector health"
            description="Per partner, over the last 24 hours. Latency is measured over finished attempts only — counting in-flight ones makes a hung connector look fast."
          />
          <DataTable
            className="mx-console-table"
            rows={data.connectors}
            rowId={(row) => row.connectorId}
            caption="Connector health by partner"
            columns={[
              { id: 'institution', header: 'Partner', value: (row) => row.institution, sortable: true },
              { id: 'type', header: 'Type', value: (row) => row.type },
              {
                id: 'health',
                header: 'Health',
                value: (row) => row.health,
                sortable: true,
                render: (row) => <Badge tone={HEALTH_TONE[row.health]}>{row.health}</Badge>,
              },
              {
                id: 'rate',
                header: 'Success',
                value: (row) => row.successRate ?? -1,
                sortable: true,
                render: (row) => (row.successRate === null ? '—' : `${row.successRate}%`),
              },
              {
                id: 'p95',
                header: 'p95',
                value: (row) => row.p95LatencyMs ?? -1,
                sortable: true,
                render: (row) => (row.p95LatencyMs === null ? '—' : `${row.p95LatencyMs} ms`),
              },
              { id: 'retries', header: 'Retries', value: (row) => row.retries },
              {
                id: 'dead',
                header: 'Dead letters',
                value: (row) => row.deadLettered,
                sortable: true,
                render: (row) =>
                  row.deadLettered === 0 ? '0' : <Badge tone="danger">{row.deadLettered}</Badge>,
              },
              {
                id: 'toggle',
                header: 'Enabled',
                value: (row) => String(row.enabled),
                render: (row) => (
                  <ConsoleAction
                    path={`/admin/ops/connectors/${row.connectorId}/enabled`}
                    body={{ enabled: !row.enabled }}
                    label={row.enabled ? 'Disable' : 'Enable'}
                    variant={row.enabled ? 'destructive' : 'secondary'}
                    confirm={
                      row.enabled
                        ? {
                            title: 'Disable this connector',
                            consequences: (
                              <>
                                New submissions to {row.institution} will stop. Applications already
                                in flight keep their retries; nothing is lost, but nothing new is
                                delivered until it is switched back on.
                              </>
                            ),
                            phrase: 'disable',
                            submitLabel: 'Disable connector',
                          }
                        : undefined
                    }
                  />
                ),
              },
            ]}
            empty={
              <EmptyState
                title="No connectors configured"
                description="A partner gets a connector when direct submission is switched on for them."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Application exceptions"
            description="Every row names what to do about it. An exceptions queue that only says something is broken is a queue that gets muted."
          />
          <DataTable
            className="mx-console-table"
            rows={[
              ...data.exceptions.stuckPending.map((row) => ({
                id: row.applicationId,
                kind: 'stuck' as const,
                institution: row.institution,
                detail: row.hasReference
                  ? 'Reference given, state never advanced'
                  : 'No reference from the partner',
                remediation: row.remediation,
              })),
              ...data.exceptions.failed.map((row) => ({
                id: row.applicationId,
                kind: 'failed' as const,
                institution: row.institution,
                detail: row.failureCode ?? 'unknown failure',
                remediation: row.remediation,
              })),
              ...data.exceptions.deadLettered.map((row) => ({
                id: row.applicationId,
                kind: 'dead-lettered' as const,
                institution: `attempt ${row.attemptNo}`,
                detail: row.failureCode ?? 'unknown failure',
                remediation: row.remediation,
              })),
            ]}
            rowId={(row) => `${row.kind}:${row.id}`}
            caption="Applications needing operator attention"
            columns={[
              {
                id: 'kind',
                header: 'Kind',
                value: (row) => row.kind,
                sortable: true,
                render: (row) => (
                  <Badge tone={row.kind === 'dead-lettered' ? 'danger' : 'warning'}>{row.kind}</Badge>
                ),
              },
              { id: 'application', header: 'Application', value: (row) => row.id },
              { id: 'where', header: 'Partner', value: (row) => row.institution },
              { id: 'detail', header: 'What happened', value: (row) => row.detail },
              { id: 'remediation', header: 'What to do', value: (row) => row.remediation },
            ]}
            empty={
              <EmptyState
                title="Nothing stuck"
                description="Every application is either progressing or finished."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Catalogue sync"
            description="The most recent runs across every partner, with the records each one changed and failed."
          />
          <DataTable
            className="mx-console-table"
            rows={data.catalogue.runs}
            rowId={(row) => row.id}
            caption="Catalogue sync runs"
            columns={[
              { id: 'institution', header: 'Partner', value: (row) => row.institution, sortable: true },
              {
                id: 'status',
                header: 'Status',
                value: (row) => row.status,
                sortable: true,
                render: (row) => (
                  <Badge
                    tone={
                      row.status === 'succeeded'
                        ? 'success'
                        : row.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {row.status}
                  </Badge>
                ),
              },
              { id: 'seen', header: 'Seen', value: (row) => row.recordsSeen },
              { id: 'changed', header: 'Changed', value: (row) => row.recordsChanged },
              {
                id: 'failed',
                header: 'Failed',
                value: (row) => row.recordsFailed,
                render: (row) =>
                  row.recordsFailed === 0 ? '0' : <Badge tone="danger">{row.recordsFailed}</Badge>,
              },
              {
                id: 'when',
                header: 'Started',
                value: (row) => row.startedAt,
                sortable: true,
                render: (row) => new Date(row.startedAt).toLocaleString(),
              },
            ]}
            empty={
              <EmptyState
                title="No sync runs recorded"
                description="Partners on manual catalogue entry never produce one."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Support sessions"
            description="Every open impersonation, with the ticket it was granted under. The student sees the same record on their own account."
          />
          <DataTable
            className="mx-console-table"
            rows={data.impersonations}
            rowId={(row) => row.id}
            caption="Open support sessions"
            columns={[
              { id: 'operator', header: 'Operator', value: (row) => row.operatorId },
              { id: 'subject', header: 'Account', value: (row) => row.subjectId },
              { id: 'reference', header: 'Ticket', value: (row) => row.reference },
              { id: 'reason', header: 'Reason', value: (row) => row.reason },
              {
                id: 'expires',
                header: 'Ends',
                value: (row) => row.expiresAt,
                render: (row) => new Date(row.expiresAt).toLocaleTimeString(),
              },
              {
                id: 'end',
                header: '',
                value: (row) => row.id,
                render: (row) => (
                  <ConsoleAction
                    path={`/admin/ops/impersonations/${row.id}/end`}
                    body={{ reason: 'Ended from the operations console.' }}
                    label="End now"
                  />
                ),
              },
            ]}
            empty={
              <EmptyState
                title="Nobody is inside an account"
                description="Support sessions need the student's consent and expire on their own."
              />
            }
          />
        </Card>
      </div>
    </ConsoleShell>
  );
}
