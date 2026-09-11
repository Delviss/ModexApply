import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { systemActor } from '../auth/audit-actor.js';
import { QueueService, QUEUES } from '../queue/queue.service.js';
import { IndexerService } from '../search/indexer.service.js';
import { OffersService } from './offers.service.js';

export interface ExpirySweepResult {
  expired: number;
  studentsNotified: number;
  reindexed: string[];
}

/**
 * The auto-expiry sweep (Phase 5 §2).
 *
 * > An offer that expires disappears from recommendations automatically,
 * > without anyone remembering to remove it.
 *
 * So there is no human step anywhere in this file, and no queue it hands work
 * to and then trusts: within one cycle the offer is out of the published set,
 * every attachment on an application is marked `expired`, the affected students
 * have a notification queued, and the programmes that were showing the offer are
 * re-indexed.
 *
 * It is idempotent. A replayed job finds nothing still published in the past and
 * does nothing — which is what makes the retry safe, and what lets it be run
 * from a test with a fake clock.
 */
@Injectable()
export class OfferExpiryService {
  private readonly logger = new Logger(OfferExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly offers: OffersService,
    private readonly queue: QueueService,
    private readonly indexer: IndexerService,
  ) {}

  async sweep(now: Date = new Date()): Promise<ExpirySweepResult> {
    const lapsed = await this.prisma.offer.findMany({
      where: { publicationState: 'published', validUntil: { lte: now } },
      select: { id: true, offerKey: true, name: true, programKey: true, institutionId: true, validUntil: true },
    });

    const result: ExpirySweepResult = { expired: 0, studentsNotified: 0, reindexed: [] };

    for (const offer of lapsed) {
      const pulled = await this.offers.unpublish(
        systemActor(),
        offer.id,
        `The validity window closed on ${offer.validUntil.toISOString()}.`,
        'expired',
        now,
      );
      if (!pulled) continue;
      result.expired += 1;

      // Notify **before** expiring the attachments, not after: the notification
      // is addressed to everyone currently holding the offer, and marking them
      // expired first would leave nobody to tell. Getting this the wrong way
      // round is silent — the sweep still reports success, and the students who
      // priced their year on the award simply never hear.
      const notified = await this.offers.notifyAttachedStudents(offer.id, 'offer-expired', {
        offerName: offer.name,
        validUntil: offer.validUntil.toISOString(),
      });
      result.studentsNotified += notified;

      // An attachment is expired, never deleted. A student who priced their year
      // on this award needs to be able to see that it lapsed — and when — rather
      // than find the line has vanished from their application.
      const affected = await this.prisma.applicationOffer.updateMany({
        where: { offerId: offer.id, state: { in: ['attached', 'accepted'] } },
        data: { state: 'expired', expiredAt: now },
      });

      await this.audit.record({
        actor: systemActor(),
        action: 'offer.expired',
        objectType: 'offer',
        objectId: offer.id,
        metadata: {
          offerKey: offer.offerKey,
          validUntil: offer.validUntil.toISOString(),
          attachmentsExpired: affected.count,
          studentsNotified: notified,
        },
      });

      // Search and recommendations carry the saving, so a lapsed offer has to
      // leave the index in the same cycle it leaves the catalogue. An offer
      // pulled from the price panel but still ranking a programme as "£2,000
      // cheaper" is the same wrong price by a slower route.
      for (const programKey of await this.programmesShowing(offer)) {
        await this.indexer.reindexProgram(programKey);
        result.reindexed.push(programKey);
      }
    }

    // The next warning window, queued once per sweep rather than per offer: a
    // student hears "your award closes in three days" once, from us, before the
    // day it stops being claimable.
    const closing = await this.prisma.offer.findMany({
      where: {
        publicationState: 'published',
        validUntil: { gt: now, lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, offerKey: true, name: true, validUntil: true },
    });
    for (const offer of closing) {
      await this.offers.notifyAttachedStudents(offer.id, 'offer-closing', {
        offerName: offer.name,
        validUntil: offer.validUntil.toISOString(),
      });
    }

    if (result.expired > 0) {
      this.logger.log(
        `Expired ${result.expired} offer(s); notified ${result.studentsNotified} student(s); ` +
          `re-indexed ${result.reindexed.length} programme(s)`,
      );
    }
    return result;
  }

  /** Enqueues the sweep. Called by the scheduler and by an operator on demand. */
  async schedule(now: Date = new Date()): Promise<string> {
    return this.queue.enqueue(QUEUES.offerExpiry, 'offer-expiry-sweep', { now: now.toISOString() });
  }

  /**
   * Which programmes were showing this offer.
   *
   * An institution-wide offer touches every published programme of that
   * institution, which is why it is worth resolving rather than assuming: the
   * alternative is re-indexing the whole catalogue on every expiry.
   */
  private async programmesShowing(offer: {
    programKey: string | null;
    institutionId: string;
  }): Promise<string[]> {
    if (offer.programKey !== null) return [offer.programKey];
    const programs = await this.prisma.program.findMany({
      where: { institutionId: offer.institutionId, effectiveTo: null, status: 'published' },
      select: { programKey: true },
    });
    return programs.map((program) => program.programKey);
  }
}
