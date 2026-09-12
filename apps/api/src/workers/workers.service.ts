import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { IndexerService } from '../search/indexer.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ReverificationService } from '../guides/reverification.service.js';
import { SubmissionService } from '../applications/submission.service.js';
import { StatusPollService } from '../connectors/status-poll.service.js';
import { OfferExpiryService } from '../offers/offer-expiry.service.js';
import { ImpersonationService } from '../admin/impersonation.service.js';

export interface ReindexPayload {
  programKey: string;
}

export interface ScanPayload {
  versionId: string;
}

export interface ReverificationPayload {
  /** Optional override, so a replayed job re-decides against its own clock. */
  now?: string;
}

export interface PartnershipCascadePayload {
  institutionId: string;
  partnershipId: string;
  reason: string;
}

export interface SubmissionRetryPayload {
  applicationId: string;
  snapshotId: string;
  submissionNo: number;
  attemptNo: number;
}

export interface ConnectorPollPayload {
  now?: string;
}

export interface OfferExpiryPayload {
  /** Optional override, so a replayed job re-decides against its own clock. */
  now?: string;
}

export interface ImpersonationSweepPayload {
  now?: string;
}

/**
 * Registers the background workers.
 *
 * Phases 0 and 1 declared queue names and enqueued to one of them, but nothing
 * ever registered a consumer — `QueueService.register` had no call sites. These
 * are the first, and the two that Phase 2 cannot work without: search goes
 * stale without the indexer, and documents stay `pending` forever without the
 * scanner.
 *
 * Both handlers are idempotent, which is what makes BullMQ's retry safe:
 * reindexing rebuilds from the authoritative tables, and re-scanning a version
 * writes the same verdict. A replayed job is a no-op, not a duplicate.
 */
@Injectable()
export class WorkersService implements OnModuleInit {
  private readonly logger = new Logger(WorkersService.name);

  constructor(
    private readonly queue: QueueService,
    private readonly indexer: IndexerService,
    private readonly documents: DocumentsService,
    private readonly reverification: ReverificationService,
    private readonly submissions: SubmissionService,
    private readonly statusPoll: StatusPollService,
    private readonly offerExpiry: OfferExpiryService,
    private readonly impersonation: ImpersonationService,
  ) {}

  onModuleInit(): void {
    // The API process registers these too, so a single-process deployment
    // works out of the box. `worker.ts` runs the same registrations with no
    // HTTP server when the two are scaled separately.
    this.registerAll();
  }

  registerAll(): void {
    this.queue.register<ReindexPayload>(QUEUES.searchIndex, async (payload) => {
      await this.indexer.reindexProgram(payload.programKey);
    });

    this.queue.register<ScanPayload>(QUEUES.documentScan, async (payload) => {
      await this.documents.runScan(payload.versionId);
    });

    // Phase 3. The expiry sweep is the acceptance criterion "notify → restrict
    // → suspend, with no human step": nothing in this handler waits for a
    // person, and `guideLifecycleDecision` makes a replayed job a no-op.
    this.queue.register<ReverificationPayload>(QUEUES.guideReverification, async (payload) => {
      await this.reverification.sweep(payload.now === undefined ? new Date() : new Date(payload.now));
    });

    // The other half of Phase 1's partnership cascade. Programme unpublish is
    // inline and transactional over there — it must not wait on a queue — and
    // the guide roster is here, because suspending guides writes a system
    // message into every open conversation.
    this.queue.register<PartnershipCascadePayload>(QUEUES.partnershipCascade, async (payload) => {
      await this.reverification.suspendRosterForInstitution(
        payload.institutionId,
        `The university's partnership was revoked: ${payload.reason}`,
      );
    });

    // Phase 4. The retry is what keeps a timed-out submission from sitting in
    // `submitted_pending` forever, and it is idempotent twice over: it no-ops
    // if a webhook confirmed the submission first, and the partner key it
    // re-sends is derived from the snapshot rather than from this job.
    this.queue.register<SubmissionRetryPayload>(QUEUES.connectorSubmission, async (payload) => {
      await this.submissions.retry(
        payload.applicationId,
        payload.snapshotId,
        payload.submissionNo,
        payload.attemptNo,
      );
    });

    // The fallback for partners with no webhooks. Rate-limited per partner
    // inside the sweep, from their own `pollIntervalSeconds`.
    this.queue.register<ConnectorPollPayload>(QUEUES.connectorPoll, async (payload) => {
      await this.statusPoll.sweep(payload.now === undefined ? new Date() : new Date(payload.now));
    });

    // Phase 5. "An offer that expires disappears from recommendations
    // automatically, without anyone remembering to remove it" — this
    // registration is the "automatically". The sweep is idempotent: a replayed
    // job finds nothing still published in the past and does nothing.
    this.queue.register<OfferExpiryPayload>(QUEUES.offerExpiry, async (payload) => {
      await this.offerExpiry.sweep(payload.now === undefined ? new Date() : new Date(payload.now));
    });

    // Phase 6. The expiry is already enforced on every request — this sweep is
    // what closes the grant, revokes the impersonation session and writes the
    // end event, so the audit log has a start and an end for every visit.
    this.queue.register<ImpersonationSweepPayload>(QUEUES.impersonationSweep, async (payload) => {
      await this.impersonation.sweepExpired(
        payload.now === undefined ? new Date() : new Date(payload.now),
      );
    });

    this.logger.log(
      'Registered workers for search-index, document-scan, guide-reverification, ' +
        'partnership-cascade, connector-submission, connector-poll, offer-expiry ' +
        'and impersonation-sweep',
    );
  }
}
