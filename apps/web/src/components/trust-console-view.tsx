'use client';

import Link from 'next/link';
import { Badge, Card, CardHeader, DataTable, EmptyState, StatCard } from '@modex/ui';
import { ConsoleShell } from './console-shell';
import { ConsoleAction } from './console-chrome';
import type { ConsoleSession } from '@/lib/console';

interface Summary {
  openCases: number;
  criticalCases: number;
  queue: { institutions: number; guides: number; offers: number };
  flagsLast24h: number;
  activeSanctions: number;
}

interface QueueRow {
  kind: 'institution' | 'guide' | 'offer';
  id: string;
  label: string;
  detail: string;
  waitingSince: string;
  ageHours: number;
  breachingSla: boolean;
}

interface Signals {
  totals: { signal: string; count: number; critical: number }[];
}

interface TrustCase {
  id: string;
  type: string;
  state: string;
  severity: string;
  summary: string;
  targetType: string;
  targetId: string;
  openedAt: string;
}

export interface TrustConsoleData {
  summary: Summary;
  queue: { institutions: QueueRow[]; guides: QueueRow[]; offers: QueueRow[] };
  signals: Signals;
  cases: TrustCase[];
}

/**
 * The Trust console's view (Phase 6 §2).
 *
 * A client component, because every `DataTable` column carries `value` and
 * `render` functions and a server component cannot hand a function to a client
 * one. The *fetch* stays on the server — the session token must never reach the
 * browser — and what crosses the boundary is plain JSON.
 */
export function TrustConsoleView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: TrustConsoleData;
}) {
  const rows = [...data.queue.institutions, ...data.queue.guides, ...data.queue.offers].sort(
    (a, b) => b.ageHours - a.ageHours,
  );

  return (
    <ConsoleShell session={session} current="trust" title="Trust console">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          }}
        >
          <StatCard label="Open cases" value={data.summary.openCases} />
          <StatCard
            label="Critical"
            value={data.summary.criticalCases}
            trend={
              data.summary.criticalCases > 0
                ? { direction: 'up', label: 'needs a human now', isGood: false }
                : undefined
            }
          />
          <StatCard label="Awaiting verification" value={rows.length} />
          <StatCard label="Flags, last 24h" value={data.summary.flagsLast24h} />
          <StatCard label="Sanctions in force" value={data.summary.activeSanctions} />
        </section>

        <Card padding="lg">
          <CardHeader
            title="Verification queue"
            description="Sorted by how long the applicant has been waiting, not by when the row was created."
          />
          <DataTable
            className="mx-console-table"
            rows={rows}
            rowId={(row) => `${row.kind}:${row.id}`}
            caption="Institutions, guides and offers awaiting review"
            columns={[
              {
                id: 'kind',
                header: 'Type',
                value: (row) => row.kind,
                render: (row) => <Badge tone="neutral">{row.kind}</Badge>,
                sortable: true,
              },
              { id: 'label', header: 'Subject', value: (row) => row.label, sortable: true },
              { id: 'detail', header: 'Stage', value: (row) => row.detail },
              {
                id: 'age',
                header: 'Waiting',
                value: (row) => row.ageHours,
                sortable: true,
                render: (row) => (
                  <span>
                    {row.ageHours}h{' '}
                    {row.breachingSla ? <Badge tone="warning">SLA breached</Badge> : null}
                  </span>
                ),
              },
              {
                id: 'evidence',
                header: 'Evidence',
                value: (row) => row.id,
                render: (row) =>
                  row.kind === 'offer' ? (
                    <span style={{ color: 'var(--mx-text-muted)' }}>—</span>
                  ) : (
                    <Link
                      href={`/admin/trust/evidence/${row.kind}/${row.id}`}
                      title="Opening evidence is recorded against your name"
                    >
                      Open (audited)
                    </Link>
                  ),
              },
            ]}
            empty={
              <EmptyState
                title="Nothing waiting"
                description="Every institution, guide and offer has been reviewed."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Risk signals"
            description="Grouped by rule over seven days, so a spike reads as a spike rather than as a slightly longer list."
          />
          <DataTable
            className="mx-console-table"
            rows={data.signals.totals}
            rowId={(row) => row.signal}
            caption="Risk signals by rule"
            columns={[
              { id: 'signal', header: 'Signal', value: (row) => row.signal, sortable: true },
              { id: 'count', header: 'Fired', value: (row) => row.count, sortable: true },
              {
                id: 'critical',
                header: 'Critical',
                value: (row) => row.critical,
                sortable: true,
                render: (row) =>
                  row.critical === 0 ? '0' : <Badge tone="danger">{row.critical}</Badge>,
              },
            ]}
            empty={<EmptyState title="No signals" description="Nothing tripped a rule this week." />}
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Open cases"
            description="Every report lands here, whether a person or a rule opened it."
          />
          <DataTable
            className="mx-console-table"
            rows={data.cases}
            rowId={(row) => row.id}
            caption="Open trust cases"
            columns={[
              { id: 'type', header: 'Type', value: (row) => row.type, sortable: true },
              {
                id: 'severity',
                header: 'Severity',
                value: (row) => row.severity,
                sortable: true,
                render: (row) => (
                  <Badge tone={row.severity === 'critical' ? 'danger' : 'warning'}>
                    {row.severity}
                  </Badge>
                ),
              },
              { id: 'summary', header: 'Summary', value: (row) => row.summary },
              {
                id: 'target',
                header: 'Target',
                value: (row) => `${row.targetType} ${row.targetId}`,
              },
              {
                id: 'actions',
                header: 'Action',
                value: (row) => row.id,
                render: (row) =>
                  row.targetType === 'guide' ? (
                    <ConsoleAction
                      path="/admin/trust/sanctions"
                      body={{
                        targetType: 'guide',
                        targetId: row.targetId,
                        kind: 'suspend',
                        reasonCode: 'payment_solicitation',
                        caseId: row.id,
                        expiresAt: null,
                      }}
                      label="Suspend guide"
                      variant="destructive"
                      confirm={{
                        title: 'Suspend this guide',
                        consequences: (
                          <>
                            They leave the directory immediately, every open conversation is closed
                            with a system message, and every scheduled session is cancelled. This is
                            reversible, and the reversal is recorded too.
                          </>
                        ),
                        phrase: 'suspend',
                        submitLabel: 'Suspend',
                      }}
                    />
                  ) : (
                    <span style={{ color: 'var(--mx-text-muted)' }}>Review in case detail</span>
                  ),
              },
            ]}
            empty={<EmptyState title="No open cases" description="The queue is clear." />}
          />
        </Card>
      </div>
    </ConsoleShell>
  );
}
