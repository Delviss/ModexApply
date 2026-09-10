import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { IndexerService } from '../search/indexer.service.js';
import { DocumentsService } from '../documents/documents.service.js';

export interface ReindexPayload {
  programKey: string;
}

export interface ScanPayload {
  versionId: string;
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

    this.logger.log('Registered workers for search-index and document-scan');
  }
}
