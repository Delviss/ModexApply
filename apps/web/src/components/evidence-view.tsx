'use client';

import Link from 'next/link';
import { Alert, Badge, Card, CardHeader, DataTable, EmptyState } from '@modex/ui';
import { ConsoleShell } from './console-shell';
import type { ConsoleSession } from '@/lib/console';

interface InstitutionEvidence {
  institution: { id: string; displayName: string };
  evidence: {
    id: string;
    stage: string;
    summary: string;
    collectedBy: string;
    collectedAt: string;
    documentRef: string | null;
  }[];
}

interface GuideEvidence {
  guide: { id: string; state: string; stage: string; institutionId: string };
  evidence: {
    id: string;
    evidenceType: string;
    evidenceRef: string | null;
    summary: string;
    verifiedAt: string | null;
    expiresAt: string | null;
    reviewerId: string | null;
    createdAt: string;
  }[];
}

export type EvidencePayload =
  | { kind: 'institution'; payload: InstitutionEvidence }
  | { kind: 'guide'; payload: GuideEvidence };

/**
 * Verification evidence, rendered.
 *
 * Document *references* are shown; documents are not. Fetching the file is a
 * separate signed-URL call with its own audit event — inlining a passport scan
 * here would put it in every screenshot and every browser cache from now on.
 */
export function EvidenceView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: EvidencePayload;
}) {


  return (
    <ConsoleShell session={session} current="trust" title="Verification evidence">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
        <Alert tone="warning" title="This view is recorded">
          Opening this page wrote an audit event naming you, the records you opened, and when. That
          record cannot be edited or deleted by anyone, including Modex.
        </Alert>

        {data.kind === 'institution' ? (
          <Card padding="lg">
            <CardHeader
              title={data.payload.institution.displayName}
              description="Evidence collected during institution verification. Stored apart from the public record and never exposed publicly."
            />
            <DataTable
              className="mx-console-table"
              rows={data.payload.evidence}
              rowId={(row) => row.id}
              caption="Institution verification evidence"
              columns={[
                { id: 'stage', header: 'Stage', value: (row) => row.stage, sortable: true },
                { id: 'summary', header: 'What was checked', value: (row) => row.summary },
                { id: 'by', header: 'Collected by', value: (row) => row.collectedBy },
                {
                  id: 'at',
                  header: 'Collected',
                  value: (row) => row.collectedAt,
                  sortable: true,
                  render: (row) => new Date(row.collectedAt).toLocaleDateString(),
                },
                {
                  id: 'ref',
                  header: 'Document',
                  value: (row) => row.documentRef ?? '',
                  render: (row) =>
                    row.documentRef === null ? (
                      <span style={{ color: 'var(--mx-text-muted)' }}>No file</span>
                    ) : (
                      <code style={{ fontSize: 'var(--mx-text-xs)' }}>{row.documentRef}</code>
                    ),
                },
              ]}
              empty={
                <EmptyState
                  title="No evidence recorded"
                  description="This institution reached its current state without stored evidence, which is itself worth asking about."
                />
              }
            />
          </Card>
        ) : (
          <Card padding="lg">
            <CardHeader
              title="Guide verification"
              description={`State: ${data.payload.guide.state} · stage: ${data.payload.guide.stage}`}
            />
            <DataTable
              className="mx-console-table"
              rows={data.payload.evidence}
              rowId={(row) => row.id}
              caption="Guide verification evidence"
              columns={[
                { id: 'type', header: 'Evidence', value: (row) => row.evidenceType, sortable: true },
                { id: 'summary', header: 'What was checked', value: (row) => row.summary },
                {
                  id: 'verified',
                  header: 'Verified',
                  value: (row) => row.verifiedAt ?? '',
                  render: (row) =>
                    row.verifiedAt === null ? (
                      <Badge tone="warning">Not verified</Badge>
                    ) : (
                      new Date(row.verifiedAt).toLocaleDateString()
                    ),
                },
                {
                  id: 'expires',
                  header: 'Expires',
                  value: (row) => row.expiresAt ?? '',
                  render: (row) =>
                    row.expiresAt === null ? '—' : new Date(row.expiresAt).toLocaleDateString(),
                },
              ]}
              empty={
                <EmptyState
                  title="No evidence submitted"
                  description="This guide has not uploaded anything to verify against."
                />
              }
            />
          </Card>
        )}

        <p>
          <Link href="/admin/trust">Back to the queue</Link>
        </p>
      </div>
    </ConsoleShell>
  );
}
