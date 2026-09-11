'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  ConsentChecklist,
  DisclosureNotice,
  ScanStatePill,
  SubmissionState,
  WizardSteps,
  type WizardStep,
} from '@modex/ui';
import type {
  ApplicationState,
  ConnectorType,
  RequirementDrift,
  ScanState,
  SubmissionConsentId,
} from '@modex/contracts';

export interface WizardDocument {
  id: string;
  displayName: string;
  type: string;
  version: number | null;
  checksum: string | null;
  scanState: ScanState;
  usable: boolean;
}

export interface WizardBlocker {
  code: string;
  message: string;
  remedy: string | null;
}

export interface WizardConsent {
  id: SubmissionConsentId;
  granted: boolean;
}

export interface ApplicationWizardProps {
  applicationId: string;
  state: ApplicationState;
  institutionName: string;
  programName: string;
  connectorType: ConnectorType | null;
  connectorDescription: string | null;
  blockers: WizardBlocker[];
  documents: WizardDocument[];
  consents: WizardConsent[];
}

/**
 * The application wizard, review-and-consent step and submit action.
 *
 * Built on `WizardSteps`' own `render`/`validate` contract rather than using it
 * as a decorative rail, so the block's rule — a step is unreachable until every
 * step before it validates — actually applies to this flow.
 *
 * Three rules from the design spec are enforced here rather than trusted:
 *
 *  1. **Completion does not fire when the last step is reached.** `onComplete`
 *     posts the submission; the application reaches `submitted` only when the
 *     connector returns a receipt. A student who has clicked through four steps
 *     has not submitted anything, and the copy never says otherwise.
 *  2. **Submit is disabled with its reasons listed**, never silently greyed. A
 *     button that will not press and will not say why is a dead end.
 *  3. **One idempotency key per intent.** Minted when the student first presses
 *     send and reused for every retry of that same intent, so a network failure
 *     followed by a second press cannot become two applications. It is cleared
 *     only when the student has to go and change something, which makes the
 *     next press a genuinely new intent.
 */
export function ApplicationWizard({
  applicationId,
  state,
  institutionName,
  programName,
  connectorType,
  connectorDescription,
  blockers,
  documents,
  consents,
}: ApplicationWizardProps) {
  const router = useRouter();
  const [accepted, setAccepted] = useState<SubmissionConsentId[]>(
    consents.filter((consent) => consent.granted).map((consent) => consent.id),
  );
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState<RequirementDrift[]>([]);
  const [busy, setBusy] = useState(false);

  // Survives re-renders and retries; deliberately not regenerated per attempt.
  const idempotencyKey = useRef<string | null>(null);

  const usableDocuments = useMemo(
    () => documents.filter((document) => document.usable),
    [documents],
  );
  const blockedDocuments = useMemo(
    () => documents.filter((document) => !document.usable),
    [documents],
  );

  const allConsented = consents.every((consent) => accepted.includes(consent.id));
  const submitBlockers: string[] = [
    ...blockers.map((blocker) => blocker.message),
    ...(allConsented ? [] : ['Every consent has to be given before we can send anything.']),
    ...(state === 'draft' ? ['Mark the application ready first.'] : []),
    ...(connectorType === null
      ? [`${institutionName} has not switched on direct submission yet.`]
      : []),
  ];
  const canSubmit = submitBlockers.length === 0 && (state === 'ready' || state === 'failed');

  async function markReady(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/applications/${applicationId}/ready`, { method: 'POST' });
    setBusy(false);
    if (!response.ok) {
      setError(await messageOf(response, 'We could not mark this application ready.'));
      return;
    }
    router.refresh();
  }

  async function saveConsents(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/applications/${applicationId}/consents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accepted }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await messageOf(response, 'We could not record your consents.'));
      return;
    }
    router.refresh();
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    setDrift([]);

    const response = await fetch(`/api/applications/${applicationId}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey.current,
      },
      body: JSON.stringify({}),
    });
    setBusy(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string; details?: { requirementChanges?: RequirementDrift[] } } }
        | null;
      const changes = payload?.error?.details?.requirementChanges;
      if (Array.isArray(changes) && changes.length > 0) {
        // The requirements moved. The student has to act before pressing send
        // means the same thing again, so the next press is a new intent and
        // gets a new key.
        idempotencyKey.current = null;
        setDrift(changes);
      }
      setError(payload?.error?.message ?? 'We could not send this application.');
      router.refresh();
      return;
    }

    router.refresh();
  }

  const steps: WizardStep[] = [
    {
      id: 'review',
      title: 'Review',
      description: `${programName} at ${institutionName}.`,
      validate: () =>
        blockers.length === 0
          ? null
          : 'Some details are still missing. The list below says which.',
      render: () => (
        <div className="mx-application-wizard__panel">
          {connectorDescription === null ? (
            <Alert tone="warning" title="No submission route yet">
              {institutionName} has not switched on direct submission through Modex Apply. You can
              keep preparing this application; we will tell you the moment it can be sent.
            </Alert>
          ) : (
            <p className="mx-card__description">{connectorDescription}</p>
          )}

          {blockers.length === 0 ? null : (
            <Alert tone="warning" title="Some things are still missing">
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker.code}>
                    {blocker.message}
                    {blocker.remedy === null ? null : <> {blocker.remedy}</>}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {state === 'draft' ? (
            <Button
              variant="primary"
              onClick={() => void markReady()}
              disabled={busy || blockers.length > 0}
            >
              Mark ready to submit
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      id: 'documents',
      title: 'Documents',
      description: 'These exact versions, and no others. Anything uploaded later is not included.',
      render: () => (
        <div className="mx-application-wizard__panel">
          <table className="mx-table">
            <caption className="mx-visually-hidden">
              Documents included in this application, with their version and scan state
            </caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Version</th>
                <th scope="col">Fingerprint</th>
                <th scope="col">Checked</th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    You have not uploaded any documents.{' '}
                    <Link href="/documents">Open your vault</Link>.
                  </td>
                </tr>
              ) : (
                documents.map((document) => (
                  <tr key={document.id} data-usable={document.usable}>
                    <th scope="row">{document.displayName}</th>
                    <td>{document.version ?? '—'}</td>
                    {/* The checksum is shown rather than hidden behind a
                        disclosure: it is the thing that proves which bytes
                        went, and a proof nobody can see is not one. */}
                    <td className="mx-application-wizard__checksum">
                      {document.checksum?.slice(0, 12) ?? '—'}
                    </td>
                    <td>
                      <ScanStatePill state={document.scanState} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {blockedDocuments.length === 0 ? null : (
            <Alert tone="warning" title="Some uploads will not be sent">
              {blockedDocuments.length} of your documents has not passed our malware check, so it
              cannot be included. <Link href="/documents">Fix them in your vault</Link> if the
              university needs them.
            </Alert>
          )}
        </div>
      ),
    },
    {
      id: 'consent',
      title: 'Consent',
      validate: () =>
        allConsented
          ? null
          : 'All three consents are needed. We will not send an application on a partial consent.',
      render: () => (
        <div className="mx-application-wizard__panel">
          <ConsentChecklist
            institutionName={institutionName}
            documentCount={usableDocuments.length}
            accepted={accepted}
            disabled={busy}
            onChange={(id, isAccepted) =>
              setAccepted((previous) =>
                isAccepted
                  ? [...new Set([...previous, id])]
                  : previous.filter((entry) => entry !== id),
              )
            }
          />
          <Button
            variant="secondary"
            onClick={() => void saveConsents()}
            disabled={busy || !allConsented}
          >
            Save my consents
          </Button>
        </div>
      ),
    },
    {
      id: 'submit',
      title: 'Send',
      description: `This is the last step you control. After it, ${institutionName} decides.`,
      validate: () => (canSubmit ? null : submitBlockers.join(' ')),
      render: () => (
        <div className="mx-application-wizard__panel">
          <SubmissionState
            state={state}
            institutionName={institutionName}
            connectorType={connectorType}
          />

          {connectorType === 'operator_assisted' ? (
            <DisclosureNotice kind="partnership" title="How this application is sent">
              {institutionName} cannot yet receive applications automatically, so a named member of
              Modex staff submits this one by hand under the consent you gave. Who did it and when
              stays on this application permanently.
            </DisclosureNotice>
          ) : null}

          {canSubmit ? null : (
            <ul className="mx-application-wizard__reason">
              {submitBlockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-application-wizard">
      {error === null ? null : (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      )}

      {drift.length === 0 ? null : (
        <Alert tone="warning" title={`${institutionName} changed what it asks for`}>
          <ul>
            {drift.map((change) => (
              <li key={`${change.kind}:${change.requirementId}`}>{change.explanation}</li>
            ))}
          </ul>
        </Alert>
      )}

      <WizardSteps
        steps={steps}
        onComplete={() => void submit()}
        completeLabel={busy ? 'Sending…' : `Send to ${institutionName}`}
      />
    </div>
  );
}

async function messageOf(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return payload?.error?.message ?? fallback;
}
