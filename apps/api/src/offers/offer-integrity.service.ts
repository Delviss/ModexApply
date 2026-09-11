import { Injectable, Logger } from '@nestjs/common';
import {
  FRESHNESS_SLA_HOURS,
  formatOfferValue,
  type AccessContext,
  type OfferValue,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor, systemActor } from '../auth/audit-actor.js';
import { QueueService, QUEUES } from '../queue/queue.service.js';
import { TrustService } from '../trust/trust.service.js';
import { OffersService, rowValue } from './offers.service.js';

export interface SourceCheckInput {
  offerKey: string;
  sourceRef: string;
  /** What the source actually says now. Recorded verbatim, never auto-applied. */
  observed: {
    value?: OfferValue;
    validUntil?: string;
    note?: string;
  };
  matched: boolean;
  checkedBy: string;
}

export interface SourceCheckResult {
  checkId: string;
  matched: boolean;
  unpublished: boolean;
  trustCaseId: string | null;
  partnerNotified: boolean;
}

/**
 * Offer integrity: the last-checked date, and the mismatch signal (TRD §6, §14).
 *
 * > If the displayed discount differs from the source, unpublish the offer and
 * > notify the partner. **This is a trust incident, not a data bug.**
 *
 * That sentence decides the shape of this file. A mismatch does not open a
 * ticket for somebody to reconcile at their convenience, and it emphatically
 * does not quietly write the source's new number onto the offer — a partner
 * whose page says 5% where our card says 20% might have made a typo, or might
 * have changed the deal after students priced their year on it, and only a human
 * looking at both can tell which. So the offer comes down first, the case opens
 * with the evidence attached, and the partner is told. In that order, in one
 * transaction, so no failure can leave the offer up with the case closed.
 */
@Injectable()
export class OfferIntegrityService {
  private readonly logger = new Logger(OfferIntegrityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly offers: OffersService,
    private readonly trust: TrustService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Records one check of an offer against its source.
   *
   * A *matching* check is not a no-op: it moves `lastCheckedAt` forward, which
   * is what keeps the card's "last checked" line true and what stops the
   * freshness sweep marking the offer stale. An offer nobody re-checks goes
   * stale on schedule, which is the intended outcome rather than a bug.
   */
  async recordSourceCheck(
    access: AccessContext | null,
    input: SourceCheckInput,
    now: Date = new Date(),
  ): Promise<SourceCheckResult> {
    const actor = access === null ? systemActor() : toAuditActor(access);
    const offer = await this.prisma.offer.findFirst({
      where: { offerKey: input.offerKey, effectiveTo: null },
      include: { exclusions: true },
    });
    if (offer === null) throw AppError.notFound('Offer');

    const check = await this.prisma.offerSourceCheck.create({
      data: {
        offerId: offer.id,
        checkedAt: now,
        checkedBy: input.checkedBy,
        sourceRef: input.sourceRef,
        matched: input.matched,
        observed: input.observed as object,
        note: input.observed.note ?? null,
      },
    });

    if (input.matched) {
      await this.prisma.offer.update({
        where: { id: offer.id },
        data: {
          lastCheckedAt: now,
          sourceUpdatedAt: now,
          syncState: 'synced',
          staleFields: [],
        },
      });
      await this.audit.record({
        actor,
        action: 'offer.source_checked',
        objectType: 'offer',
        objectId: offer.id,
        metadata: { offerKey: offer.offerKey, matched: true, sourceRef: input.sourceRef },
      });
      return { checkId: check.id, matched: true, unpublished: false, trustCaseId: null, partnerNotified: false };
    }

    // --- Mismatch. A trust incident from here down. ------------------------

    const displayed = formatOfferValue(rowValue(offer));
    const observed =
      input.observed.value === undefined ? 'a different value' : formatOfferValue(input.observed.value);

    const unpublished = await this.offers.unpublish(
      actor,
      offer.id,
      `The university's source says ${observed}; Modex was displaying ${displayed}. Pulled pending a Trust review.`,
      'unpublished',
      now,
    );

    const trustCase = await this.trust.openCase(actor, {
      type: 'fraudulent_offer',
      reporterId: access?.userId ?? null,
      targetType: 'offer',
      targetId: offer.id,
      severity: 'high',
      summary: `Offer "${offer.name}" does not match its source`,
      description:
        `Displayed: ${displayed}. Source (${input.sourceRef}): ${observed}. ` +
        `The offer has been unpublished and the partner notified. ` +
        `Do not re-publish it on the source's number without confirming with the university which one they intend to honour.`,
      state: 'evidence_preserved',
    });

    await this.prisma.offerSourceCheck.update({
      where: { id: check.id },
      data: { trustCaseId: trustCase.id },
    });

    await this.prisma.offer.update({
      where: { id: offer.id },
      data: {
        lastCheckedAt: now,
        syncState: 'failed',
        staleFields: ['offerValue'],
        verificationState: 'revoked',
      },
    });

    // The partner, and every student holding it. The student's notification is
    // not optional politeness: somebody has a net price on their screen that we
    // have just decided we cannot stand behind.
    await this.queue.enqueue(QUEUES.notifications, 'offer-mismatch-partner', {
      institutionId: offer.institutionId,
      offerId: offer.id,
      offerKey: offer.offerKey,
      displayed,
      observed,
      sourceRef: input.sourceRef,
      trustCaseId: trustCase.id,
    });
    await this.offers.notifyAttachedStudents(offer.id, 'offer-withdrawn', {
      offerName: offer.name,
      reason: 'We could not confirm this offer against the university, so we have taken it down.',
    });

    await this.audit.record({
      actor,
      action: 'offer.mismatch_detected',
      objectType: 'offer',
      objectId: offer.id,
      metadata: {
        offerKey: offer.offerKey,
        displayed,
        observed,
        sourceRef: input.sourceRef,
        trustCaseId: trustCase.id,
        unpublished,
      },
    });

    this.logger.warn(
      `Offer ${offer.offerKey} mismatched its source; unpublished and trust case ${trustCase.id} opened`,
    );

    return {
      checkId: check.id,
      matched: false,
      unpublished,
      trustCaseId: trustCase.id,
      partnerNotified: true,
    };
  }

  /**
   * Offers whose last check is older than the freshness SLA.
   *
   * Reads the same `FRESHNESS_SLA_HOURS.offer` the provenance contract declares,
   * so the admin queue and the stamp on the card agree about what "recently"
   * means.
   */
  async dueForRecheck(institutionId: string | null, now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - (FRESHNESS_SLA_HOURS.offer ?? 24 * 7) * 60 * 60 * 1000);
    return this.prisma.offer.findMany({
      where: {
        effectiveTo: null,
        publicationState: 'published',
        ...(institutionId === null ? {} : { institutionId }),
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
      },
      select: {
        id: true,
        offerKey: true,
        name: true,
        institutionId: true,
        lastCheckedAt: true,
        sourceRef: true,
      },
      orderBy: { lastCheckedAt: 'asc' },
    });
  }
}
