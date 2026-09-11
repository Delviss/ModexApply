import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  Alert,
  ApplicationTimeline,
  Card,
  CardHeader,
  DisclosureNotice,
  ReceiptCard,
  SubmissionState,
  spineFor,
  type TimelineEntry,
} from '@modex/ui';
import type {
  ApplicationState,
  ConnectorType,
  ScanState,
  SubmissionConsentId,
} from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import {
  ApplicationWizard,
  type WizardDocument,
} from '@/components/application-wizard';

export const metadata: Metadata = {
  title: 'Your application',
  robots: { index: false },
};

interface ApplicationDetail {
  id: string;
  state: ApplicationState;
  headline: string;
  institution: { id: string; displayName: string; country: string };
  program: { programKey: string; name?: string; level?: string; field?: string };
  connectorType: ConnectorType | null;
  connectorDescription: string | null;
  awaitsExternalConfirmation: boolean;
  externalRef: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  operatorDisclosure: {
    submittedBy: string;
    submittedAt: string;
    noticeVersion: string;
    permanent: boolean;
  } | null;
  tasks: {
    id: string;
    owner: string;
    type: string;
    title: string;
    detail: string | null;
    dueAt: string | null;
    status: string;
  }[];
  receipts: {
    attemptNo: number;
    state: string;
    externalRef: string | null;
    failureReason: string | null;
    startedAt: string;
    finishedAt: string | null;
    correlationId: string;
    snapshot: { submissionNo: number; payloadHash: string; createdAt: string } | null;
  }[];
  universityEvents: {
    kind: string;
    occurredAt: string;
    receivedAt: string;
    applied: boolean;
    skippedReason: string | null;
    attributedTo: string;
  }[];
}

interface Readiness {
  ready: boolean;
  blockers: { code: string; message: string; remedy: string | null }[];
  consents: { id: SubmissionConsentId; title: string; body: string; granted: boolean }[];
}

interface VaultDocument {
  id: string;
  type: string;
  displayName: string;
  usable: boolean;
  currentVersion: {
    id: string;
    version: number;
    checksum: string | null;
    scanState: ScanState;
  } | null;
}

/**
 * One application: the tracker, the timeline, the receipts and the next step.
 *
 * The page is deliberately one page rather than a wizard route and a tracker
 * route. An application has exactly one state at a time, and splitting the
 * surface would mean two places that each have to get "is this submitted?"
 * right — the question this phase most needs a single answer to.
 */
export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await sessionToken();
  if (token === null) redirect(`/login?next=/applications/${id}`);

  let application: ApplicationDetail;
  let readiness: Readiness;
  let documents: VaultDocument[] = [];
  try {
    application = await apiGetAs<ApplicationDetail>(`/applications/${id}`, token);
    readiness = await apiGetAs<Readiness>(`/applications/${id}/readiness`, token);
    documents = (await apiGetAs<{ data: VaultDocument[] }>('/documents', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=/applications/${id}`);
    }
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const latestReceipt = application.receipts.at(-1) ?? null;
  const failed = application.receipts.find((receipt) => receipt.failureReason !== null) ?? null;

  const wizardDocuments: WizardDocument[] = documents.map((document) => ({
    id: document.id,
    displayName: document.displayName,
    type: document.type,
    version: document.currentVersion?.version ?? null,
    checksum: document.currentVersion?.checksum ?? null,
    scanState: document.currentVersion?.scanState ?? 'pending',
    usable: document.usable,
  }));

  const timeline: TimelineEntry[] = [
    ...spineFor(application.state),
    // University events come after the spine and are attributed to them, never
    // folded into our own steps.
    ...application.universityEvents.map((event, index) => ({
      id: `event-${index}`,
      title: EVENT_TITLES[event.kind] ?? event.kind,
      at: event.occurredAt,
      tone: 'done' as const,
      attributedTo: event.attributedTo,
      detail:
        event.applied || event.skippedReason === null
          ? undefined
          : `Recorded but did not change this application: ${event.skippedReason}.`,
    })),
  ];

  const openTasks = application.tasks.filter((task) => task.status === 'open');

  return (
    <main className="mx-application">
      <header>
        <p className="mx-card__description">
          <Link href="/applications">Your applications</Link>
        </p>
        <h1 className="mx-card__title">
          {application.program.name ?? application.program.programKey}
        </h1>
        <p className="mx-card__description">
          {application.institution.displayName}, {application.institution.country}
        </p>
      </header>

      <SubmissionState
        state={application.state}
        institutionName={application.institution.displayName}
        externalRef={application.externalRef}
        connectorType={application.connectorType}
        failureDetail={
          failed === null || failed.failureReason === null
            ? null
            : {
                what: failed.failureReason,
                next: 'Open the steps below, fix what it asks for, and send it again. Nothing has reached the university.',
              }
        }
      />

      {/*
        Permanent and never dismissible. The operator-assisted route is a
        temporary exception, and the disclosure is the price of it existing.
      */}
      {application.operatorDisclosure === null ? null : (
        <DisclosureNotice kind="partnership" title="This application was submitted for you">
          {application.operatorDisclosure.submittedBy} of Modex submitted this application on{' '}
          {new Date(application.operatorDisclosure.submittedAt).toLocaleDateString('en-GB')} under
          the consent you gave ({application.operatorDisclosure.noticeVersion}). Modex is not an
          agent and cannot influence {application.institution.displayName}&rsquo;s decision.
        </DisclosureNotice>
      )}

      {openTasks.length === 0 ? null : (
        <Alert
          tone={openTasks.some((task) => task.owner === 'student') ? 'warning' : 'info'}
          title={`${openTasks.length} thing${openTasks.length === 1 ? '' : 's'} outstanding`}
        >
          <ul>
            {openTasks.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                {task.detail === null ? null : <> — {task.detail}</>}
                {task.owner === 'student' ? null : (
                  <span className="mx-card__description"> (waiting on {task.owner === 'university' ? application.institution.displayName : 'Modex'})</span>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mx-application__columns">
        <div>
          <ApplicationWizard
            applicationId={application.id}
            state={application.state}
            institutionName={application.institution.displayName}
            programName={application.program.name ?? application.program.programKey}
            connectorType={application.connectorType}
            connectorDescription={application.connectorDescription}
            blockers={readiness.blockers}
            documents={wizardDocuments}
            consents={readiness.consents.map((consent) => ({
              id: consent.id,
              granted: consent.granted,
            }))}
          />
        </div>

        <aside className="mx-application__side">
          <Card padding="lg">
            <CardHeader
              title="What has happened"
              description="Anything the university reported is marked as theirs."
            />
            <ApplicationTimeline entries={timeline} />
          </Card>

          {latestReceipt === null ? null : (
            <Card padding="lg">
              <CardHeader
                title="Your receipt"
                description="Keep this. It is what proves what was sent, and when."
              />
              <ReceiptCard
                institutionName={application.institution.displayName}
                externalRef={application.externalRef}
                confirmedAt={application.confirmedAt}
                submissionNo={latestReceipt.snapshot?.submissionNo ?? 1}
                payloadHash={latestReceipt.snapshot?.payloadHash ?? null}
                // Verification is a server-side recomputation; the page links to
                // it rather than claiming a result it did not compute.
                verified={null}
                documentCount={wizardDocuments.filter((document) => document.usable).length}
                summaryHref={`/applications/${application.id}/receipt/${
                  latestReceipt.snapshot?.submissionNo ?? 1
                }`}
              />
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

const EVENT_TITLES: Record<string, string> = {
  received: 'Confirmed as received',
  under_review: 'Moved into review',
  more_info_required: 'More information asked for',
  offer_made: 'Offer made',
  rejected: 'Application rejected',
  withdrawn: 'Application withdrawn',
  enrolled: 'Enrolment confirmed',
};
