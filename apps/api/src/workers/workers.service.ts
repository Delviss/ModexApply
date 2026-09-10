import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { IndexerService } from '../search/indexer.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ReverificationService } from '../guides/reverification.service.js';

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

    this.logger.log(
      'Registered workers for search-index, document-scan, guide-reverification and partnership-cascade',
    );
  }
}
