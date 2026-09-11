import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_SUBMISSION_ATTEMPTS,
  attemptStateFor,
  failureGuidance,
  isReceipt,
  retryDelaySeconds,
  type ApplicationPayload,
  type ConnectorType,
  type SubmissionOutcome,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ConnectorRegistry } from '../connectors/connector.registry.js';
import type { Prisma } from '@prisma/client';
import type { ResolvedDocument } from '../connectors/connector.port.js';
import { ApplicationStateService } from './application-state.service.js';

export interface DispatchRequest {
  applicationId: string;
  /** The snapshot being sent. Shared by every retry of the same submission. */
  snapshotId: string;
  submissionNo: number;
  /** Sequential network call, retries included. */
  attemptNo: number;
  payload: ApplicationPayload;
  /** The snapshot's hash, threaded through so the audit row ties to the snapshot. */
  payloadHash: string;
  documents: readonly ResolvedDocument[];
  actor: AuditActor;
  operator?: { userId: string; displayName: string };
}

/**
 * The key the *university* dedupes on.
 *
 * Derived from the submission rather than from the HTTP request, so every retry
 * of one payload carries the same value and a partner sees one application —
 * while a genuine resubmission after a rejection builds a new snapshot, gets
 * the next submission number, and is correctly treated as a new application.
 */
export function partnerIdempotencyKey(applicationId: string, submissionNo: number): string {
  return `modex-${applicationId}-${submissionNo}`;
}

export interface DispatchResult {
  state: string;
  externalRef: string | null;
  outcome: SubmissionOutcome;
  attemptId: string;
}

/**
 * The submission gateway (Phase 4 §3).
 *
 * Everything that reaches a university goes through `dispatch`, and it is the
 * only place the receipt rule is applied:
 *
 * > A submission is not successful because Modex generated a payload. It is
 * > successful only after the university endpoint confirms receipt and returns
 * > a durable reference.
 *
 * Concretely, `isReceipt(outcome)` is the sole route to `submitted`. Every
 * other outcome either leaves the application in `submitted_pending` — where
 * the student reads "Sending to …" — or moves it to `failed` with the reason
 * and the next step written down. There is no branch here that reaches
 * `submitted` on optimism.
 */
@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: ConnectorRegistry,
    private readonly state: ApplicationStateService,
    private readonly queue: QueueService,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  async dispatch(request: DispatchRequest, now: Date = new Date()): Promise<DispatchResult> {
    const application = await this.prisma.application.findUnique({
      where: { id: request.applicationId },
      include: { connector: true, institution: { select: { displayName: true } } },
    });
    if (application === null) throw AppError.notFound('Application');
    if (application.connector === null || application.connectorType === null) {
      throw new AppError(
        'precondition_failed',
        'This university has no submission route configured yet.',
      );
    }

    const availability = this.registry.isAvailable({
      enabled: application.connector.enabled,
      featureFlag: application.connector.featureFlag,
      institutionId: application.institutionId,
    });
    if (!availability.available) {
      throw new AppError('precondition_failed', availability.reason ?? 'This route is not available.');
    }

    const correlationId = currentContext()?.correlationId ?? 'system';
    const adapter = this.registry.adapterFor(application.connectorType as ConnectorType);

    // Written *before* the call, so a process that dies mid-flight leaves a
    // record that something left the building. An attempt row created after a
    // successful call would lose exactly the case we most need to reconstruct.
    const idempotencyKey = partnerIdempotencyKey(application.id, request.submissionNo);
    const attempt = await this.prisma.submissionAttempt.create({
      data: {
        applicationId: application.id,
        connectorId: application.connectorId,
        snapshotId: request.snapshotId,
        attemptNo: request.attemptNo,
        idempotencyKey,
        correlationId,
        state: 'in_flight',
      },
    });

    await this.audit.record({
      actor: request.actor,
      action: 'application.submission_attempted',
      objectType: 'application',
      objectId: application.id,
      correlationId,
      metadata: {
        attemptNo: request.attemptNo,
        submissionNo: request.submissionNo,
        connectorType: application.connectorType,
        documentCount: request.documents.length,
        payloadHash: request.payloadHash,
        idempotencyKey,
      },
    });

    let outcome: SubmissionOutcome;
    try {
      outcome = await adapter.submit({
        applicationId: application.id,
        idempotencyKey,
        attemptNo: request.attemptNo,
        correlationId,
        payload: request.payload,
        documents: request.documents,
        settings: asRecord(application.connector.settings),
        endpointUrl: application.connector.endpointUrl,
        credentialRef: application.connector.credentialRef,
        ...(request.operator === undefined ? {} : { operator: request.operator }),
      });
    } catch (error) {
      // An adapter that throws is a bug in the adapter, not a verdict from the
      // university. Treated as retryable, because the one thing we must not
      // conclude from our own crash is that the application was rejected.
      this.logger.error(
        `Connector ${application.connectorType} threw for application ${application.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      outcome = {
        status: 'retryable_failure',
        reason: 'the submission could not be completed',
        retryAfterSeconds: null,
      };
    }

    return this.applyOutcome(application, attempt.id, request, outcome, correlationId, now);
  }

  private async applyOutcome(
    application: { id: string; institution: { displayName: string }; connectorType: string | null },
    attemptId: string,
    request: DispatchRequest,
    outcome: SubmissionOutcome,
    correlationId: string,
    now: Date,
  ): Promise<DispatchResult> {
    const receipt = isReceipt(outcome);
    // Only a retryable failure can exhaust: a rejection is a verdict, and
    // retrying a verdict is how a partner ends up with six copies of a "no".
    const exhausted =
      outcome.status === 'retryable_failure' && request.attemptNo >= MAX_SUBMISSION_ATTEMPTS;

    await this.prisma.submissionAttempt.update({
      where: { id: attemptId },
      data: {
        state: exhausted ? 'dead_lettered' : attemptStateFor(outcome),
        externalRef: receipt ? outcome.externalRef : null,
        responseBody: outcomeEvidence(outcome) as Prisma.InputJsonValue,
        failureCode: outcome.status === 'rejected' ? outcome.code : null,
        failureReason:
          outcome.status === 'rejected'
            ? outcome.message
            : outcome.status === 'retryable_failure'
              ? outcome.reason
              : null,
        finishedAt: now,
        nextRetryAt:
          outcome.status === 'retryable_failure' && !exhausted
            ? new Date(
                now.getTime() +
                  (outcome.retryAfterSeconds ?? retryDelaySeconds(request.attemptNo)) * 1000,
              )
            : null,
      },
    });

    if (receipt) {
      await this.state.transition({
        applicationId: application.id,
        to: 'submitted',
        actor: request.actor,
        authority: 'system',
        data: {
          externalRef: outcome.externalRef,
          confirmedAt: new Date(outcome.receivedAt),
          currentOwner: 'university',
        },
        metadata: { attemptNo: request.attemptNo, connectorType: application.connectorType },
      });
      await this.audit.record({
        actor: request.actor,
        action: 'application.submitted',
        objectType: 'application',
        objectId: application.id,
        correlationId,
        metadata: { externalRef: outcome.externalRef, attemptNo: request.attemptNo },
      });
      await this.closeTask(application.id, 'university_review');
      return { state: 'submitted', externalRef: outcome.externalRef, outcome, attemptId };
    }

    if (outcome.status === 'rejected') {
      const guidance = failureGuidance(outcome, application.institution.displayName);
      await this.state.transition({
        applicationId: application.id,
        to: 'failed',
        actor: request.actor,
        authority: 'system',
        data: { currentOwner: 'student' },
        metadata: { code: outcome.code, reason: outcome.message },
      });
      await this.openTask(application.id, {
        owner: 'student',
        type: 'provide_more_info',
        title: 'Fix and resend this application',
        detail: `${guidance.what} ${guidance.next}`,
      });
      await this.audit.record({
        actor: request.actor,
        action: 'application.submission_failed',
        objectType: 'application',
        objectId: application.id,
        correlationId,
        metadata: { attemptNo: request.attemptNo, code: outcome.code, reason: outcome.message },
      });
      return { state: 'failed', externalRef: null, outcome, attemptId };
    }

    if (exhausted) {
      // Dead-letter: a human has to look. The application stays in
      // `submitted_pending` rather than moving to `failed`, because after six
      // timeouts we genuinely do not know whether the university has it — and
      // "failed" would be a claim we cannot support either.
      await this.queue
        .enqueue(QUEUES.notifications, 'submission-dead-letter', {
          applicationId: application.id,
          attemptNo: request.attemptNo,
          correlationId,
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Could not raise the dead-letter alert for application ${application.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      await this.audit.record({
        actor: systemActor(),
        action: 'application.submission_dead_lettered',
        objectType: 'application',
        objectId: application.id,
        correlationId,
        metadata: { attemptNo: request.attemptNo, reason: outcome.reason },
      });
      await this.openTask(application.id, {
        owner: 'modex_ops',
        type: 'provide_more_info',
        title: 'Submission stuck after every retry',
        detail: `We could not get a confirmation from ${application.institution.displayName} after ${MAX_SUBMISSION_ATTEMPTS} attempts. Nothing has been confirmed to the student as submitted.`,
      });
      return { state: 'submitted_pending', externalRef: null, outcome, attemptId };
    }

    if (outcome.status === 'retryable_failure') {
      await this.queue
        .enqueue(
          QUEUES.connectorSubmission,
          'retry-submission',
          {
            applicationId: application.id,
            snapshotId: request.snapshotId,
            submissionNo: request.submissionNo,
            attemptNo: request.attemptNo + 1,
          },
          {
            delay:
              (outcome.retryAfterSeconds ?? retryDelaySeconds(request.attemptNo)) * 1000,
          },
        )
        .catch((error: unknown) => {
          this.logger.error(
            `Could not enqueue the retry for application ${application.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
    }

    // `handoff_required`, `queued` and a retryable failure with attempts left
    // all land here: the application stays in `submitted_pending`, and the
    // tracker says "Sending to …" rather than anything stronger.
    return { state: 'submitted_pending', externalRef: null, outcome, attemptId };
  }

  /**
   * Re-sends a submission that timed out (Phase 4 §3, retry with backoff).
   *
   * Re-sends **the snapshot**, not a freshly built payload. Rebuilding would
   * mean a retry could carry different bytes from the attempt it is retrying —
   * a newer profile field, a replaced document — which would make the snapshot
   * a record of the first attempt only, and "the payload is reproducible" a
   * claim that holds for some attempts and not others.
   *
   * Idempotent by construction: the partner key is derived from the snapshot,
   * so a university that already has this application answers with the original
   * reference rather than creating a second one.
   */
  async retry(
    applicationId: string,
    snapshotId: string,
    submissionNo: number,
    attemptNo: number,
    now: Date = new Date(),
  ): Promise<DispatchResult | null> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { state: true },
    });
    // A retry that arrives after a webhook already confirmed the submission is
    // a no-op, not a second call. This is the ordinary case when a partner is
    // merely slow rather than broken.
    if (application === null || application.state !== 'submitted_pending') return null;

    const snapshot = await this.prisma.applicationSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (snapshot === null) {
      this.logger.error(`Retry for application ${applicationId} has no snapshot ${snapshotId}`);
      return null;
    }

    // Fetch URLs on the stored payload have expired by now, so the documents
    // are re-signed. The *payload* is untouched — only the short-lived handles
    // the partner uses to collect the bytes are refreshed, and the checksums
    // pin which bytes those must be.
    const documents = await this.reissueDocumentHandles(snapshot.payload);

    return this.dispatch(
      {
        applicationId,
        snapshotId,
        submissionNo,
        attemptNo,
        payload: snapshot.payload as unknown as ApplicationPayload,
        payloadHash: snapshot.payloadHash,
        documents,
        actor: systemActor(),
      },
      now,
    );
  }

  private async reissueDocumentHandles(payload: unknown): Promise<ResolvedDocument[]> {
    const documents = (payload as ApplicationPayload | null)?.documents ?? [];
    const resolved: ResolvedDocument[] = [];
    for (const document of documents) {
      const version = await this.prisma.documentVersion.findUnique({
        where: { id: document.versionId },
        include: { document: { select: { ownerId: true } } },
      });
      if (version === null) continue;
      // The boundary again, on the retry path. A document quarantined between
      // the first attempt and this one must not go out on the second.
      const { objectKey, checksum } = await this.documents.resolveForConnector(
        version.document.ownerId,
        version.id,
      );
      if (checksum !== document.checksum) {
        throw new AppError(
          'precondition_failed',
          'A document changed since this application was prepared. It has not been re-sent.',
          { details: { versionId: document.versionId } },
        );
      }
      const signed = this.storage.signUrl('GET', objectKey, { ttlSeconds: 900 });
      resolved.push({
        documentId: document.documentId,
        versionId: document.versionId,
        type: document.type,
        checksum,
        sizeBytes: document.sizeBytes,
        contentType: document.contentType,
        fetchUrl: signed.url,
        fetchUrlExpiresAt: signed.expiresAt,
      });
    }
    return resolved;
  }

  private async openTask(
    applicationId: string,
    task: { owner: 'student' | 'university' | 'modex_ops'; type: 'provide_more_info'; title: string; detail: string },
  ): Promise<void> {
    await this.prisma.applicationTask.create({
      data: {
        applicationId,
        owner: task.owner,
        type: task.type,
        title: task.title,
        detail: task.detail,
      },
    });
  }

  private async closeTask(applicationId: string, type: 'university_review'): Promise<void> {
    await this.prisma.applicationTask.updateMany({
      where: { applicationId, type, status: 'open' },
      data: { status: 'done', completedAt: new Date() },
    });
  }
}

/**
 * What is kept from an outcome as evidence.
 *
 * A continuation URL is deliberately not stored: it is a bearer credential for
 * the student's own handoff, and a copy of it sitting in an attempt row that
 * ops and Trust can read is a copy that can be used.
 */
function outcomeEvidence(outcome: SubmissionOutcome): Record<string, unknown> {
  switch (outcome.status) {
    case 'accepted':
      return { status: outcome.status, receivedAt: outcome.receivedAt, evidence: outcome.evidence };
    case 'handoff_required':
      return { status: outcome.status, handoffRef: outcome.handoffRef, expiresAt: outcome.expiresAt };
    case 'queued':
      return { status: outcome.status, batchRef: outcome.batchRef, expectedBy: outcome.expectedBy };
    case 'rejected':
      return { status: outcome.status, code: outcome.code, fieldErrors: outcome.fieldErrors };
    case 'retryable_failure':
      return { status: outcome.status, reason: outcome.reason };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
