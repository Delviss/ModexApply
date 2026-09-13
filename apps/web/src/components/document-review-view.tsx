'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Select, Textarea } from '@modex/ui';
import {
  ASSESSMENT_REASONS,
  ASSESSMENT_REASON_TEXT,
  type AssessmentDecision,
  type AssessmentReason,
} from '@modex/contracts';
import { ConsoleShell } from './console-shell';
import type { ConsoleSession } from '@/lib/console';
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels';

/**
 * The document assessment console (Phase 8, #20).
 *
 * The console a reviewer works a queue in, and the rules it renders are the
 * same objects the API enforces — `canAssess`, the reason codes, the SLA — so
 * a button is disabled here for exactly the reason the endpoint would refuse.
 *
 * Two things this screen deliberately does not do:
 *
 * **It does not show the file until somebody asks for it.** Opening is a
 * separate, audited action with its own step-up. A queue that renders thumbnails
 * of everybody's passport has disclosed them all to whoever walked past the
 * desk, and no audit trail afterwards can undo that.
 *
 * **It offers no "reject" without a reason.** The reason codes are radio-like
 * checkboxes rather than free text, because the sentence the student receives
 * is generated from the code and has to be one they can act on.
 */

export interface QueueRow {
  documentVersionId: string;
  documentId: string;
  studentId: string;
  type: string;
  displayName: string;
  version: number;
  sizeBytes: number | null;
  checksum: string | null;
  uploadedAt: string;
  scanState: string;
  state: string;
  openable: boolean;
  blockReason: string | null;
  decision: AssessmentDecision | null;
  reasons: AssessmentReason[];
  note: string | null;
  decidedAt: string | null;
  overdue: boolean;
  applicationId: string | null;
  programKey: string | null;
}

export interface QueueSummary {
  awaitingScan: number;
  awaitingReview: number;
  decided: number;
  overdue: number;
  quarantined: number;
  slaHours: number;
  medianDecisionHours: number | null;
  p90DecisionHours: number | null;
}

export interface DocumentReviewData {
  rows: QueueRow[];
  summary: QueueSummary;
}

const STATE_TONE: Readonly<Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'>> = {
  awaiting_scan: 'neutral',
  awaiting_review: 'info',
  in_review: 'info',
  accepted: 'success',
  more_information: 'warning',
  rejected: 'danger',
};

const STATE_LABEL: Readonly<Record<string, string>> = {
  awaiting_scan: 'Waiting on the scan',
  awaiting_review: 'Waiting for a reviewer',
  in_review: 'Open with a reviewer',
  accepted: 'Accepted',
  more_information: 'More information needed',
  rejected: 'Not accepted',
};

export function DocumentReviewView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: DocumentReviewData;
}) {
  return (
    <ConsoleShell
      session={session}
      current="trust"
      title="Documents"
      counts={{ documents: data.summary.awaitingReview }}
      stats={[
        {
          id: 'awaiting',
          label: 'Waiting for a reviewer',
          value: String(data.summary.awaitingReview),
          detail: `Review commitment is ${data.summary.slaHours} hours`,
          tone: 'info',
        },
        {
          id: 'overdue',
          label: 'Past the commitment',
          value: String(data.summary.overdue),
          detail: 'Students were told two working days',
          tone: data.summary.overdue > 0 ? 'warning' : 'neutral',
        },
        {
          id: 'scanning',
          label: 'Still being scanned',
          value: String(data.summary.awaitingScan),
          detail: 'Nobody may open these yet',
        },
        {
          id: 'decided',
          label: 'Decided',
          value: String(data.summary.decided),
          detail:
            data.summary.medianDecisionHours === null
              ? 'No decisions yet'
              : `Median ${data.summary.medianDecisionHours.toFixed(1)} h to a decision`,
          tone: 'success',
        },
      ]}
    >
      {data.summary.quarantined > 0 ? (
        <Alert tone="danger" title="Some uploads are quarantined">
          {data.summary.quarantined} file(s) were blocked by the malware scan. Nobody opens these —
          the student is asked for a clean copy, and the version stays blocked permanently.
        </Alert>
      ) : null}

      {data.rows.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Every document attached to an application has been looked at."
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--mx-space-4)' }}>
          {data.rows.map((row) => (
            <ReviewRow key={row.documentVersionId} row={row} />
          ))}
        </div>
      )}
    </ConsoleShell>
  );
}

function ReviewRow({ row }: { row: QueueRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<AssessmentDecision>('accepted');
  const [reasons, setReasons] = useState<AssessmentReason[]>([]);
  const [note, setNote] = useState('');

  async function send(path: string, body: unknown): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? 'That did not work.');
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const needsReason = decision !== 'accepted';
  const canSubmit = !busy && (!needsReason || reasons.length > 0);

  return (
    <Card padding="lg">
      <CardHeader
        title={`${DOCUMENT_TYPE_LABELS[row.type] ?? row.type} · version ${row.version}`}
        description={`Uploaded ${new Date(row.uploadedAt).toLocaleString('en-GB')}${
          row.programKey === null ? '' : ` · attached to ${row.programKey}`
        }`}
      />

      <div style={{ display: 'flex', gap: 'var(--mx-space-2)', flexWrap: 'wrap' }}>
        <Badge tone={STATE_TONE[row.state] ?? 'neutral'}>{STATE_LABEL[row.state] ?? row.state}</Badge>
        {row.overdue ? <Badge tone="warning">Past the review commitment</Badge> : null}
        {row.checksum === null ? null : (
          <span className="mx-mono" style={{ fontSize: 'var(--mx-text-xs)' }}>
            {row.checksum.slice(0, 12)}…
          </span>
        )}
      </div>

      {row.blockReason === null ? null : (
        <Alert tone="warning" title="This file cannot be opened">
          {row.blockReason}
        </Alert>
      )}

      {row.decision !== null ? (
        <div style={{ marginTop: 'var(--mx-space-3)' }}>
          <p style={{ fontSize: 'var(--mx-text-sm)' }}>
            Decided {row.decidedAt === null ? '' : new Date(row.decidedAt).toLocaleString('en-GB')}.
          </p>
          <ul style={{ fontSize: 'var(--mx-text-sm)' }}>
            {row.reasons.map((reason) => (
              <li key={reason}>{ASSESSMENT_REASON_TEXT[reason]}</li>
            ))}
            {row.note === null ? null : <li>{row.note}</li>}
          </ul>
        </div>
      ) : row.openable ? (
        <div style={{ marginTop: 'var(--mx-space-3)', display: 'grid', gap: 'var(--mx-space-3)' }}>
          {open ? null : (
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(true);
                  void send(`/admin/documents/${row.documentVersionId}/open`, {});
                }}
              >
                Open this document
              </Button>
              <p className="mx-card__description">
                Opening is recorded against your name. Decide from the document, not from its file
                name.
              </p>
            </div>
          )}

          {open ? (
            <>
              <Field label="Decision">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={decision}
                    onChange={(event) => setDecision(event.target.value as AssessmentDecision)}
                  >
                    <option value="accepted">Accept — usable as it stands</option>
                    <option value="more_information">Needs more information</option>
                    <option value="rejected">Not accepted</option>
                  </Select>
                )}
              </Field>

              {needsReason ? (
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: 'var(--mx-text-sm)', fontWeight: 500 }}>
                    Why? The student is shown these sentences.
                  </legend>
                  {ASSESSMENT_REASONS.map((reason) => (
                    <label
                      key={reason}
                      style={{ display: 'flex', gap: 'var(--mx-space-2)', alignItems: 'flex-start' }}
                    >
                      <input
                        type="checkbox"
                        checked={reasons.includes(reason)}
                        onChange={(event) =>
                          setReasons((current) =>
                            event.target.checked
                              ? [...current, reason]
                              : current.filter((one) => one !== reason),
                          )
                        }
                      />
                      <span style={{ fontSize: 'var(--mx-text-sm)' }}>
                        {ASSESSMENT_REASON_TEXT[reason]}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <Field label="Anything else the student should know (optional)">
                {({ inputId }) => (
                  <Textarea
                    id={inputId}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                  />
                )}
              </Field>

              <div>
                <Button
                  variant="primary"
                  disabled={!canSubmit}
                  onClick={() =>
                    void send(`/admin/documents/${row.documentVersionId}/decision`, {
                      decision,
                      reasons,
                      note: note.trim() === '' ? null : note.trim(),
                    })
                  }
                >
                  Record the decision
                </Button>
                {needsReason && reasons.length === 0 ? (
                  <p className="mx-card__description">
                    A decision that is not an acceptance has to name at least one reason.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {error === null ? null : (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      )}
    </Card>
  );
}
