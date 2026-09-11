import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  OFFER_TYPE_LABELS,
  OfferConditionSchema,
  OfferExclusionSchema,
  OfferValueSchema,
  canPublishOffer,
  isOfferLive,
  offerExpiryUrgency,
  type AccessContext,
  type Offer,
  type OfferBase,
  type OfferDuration,
  type OfferExclusion,
  type OfferType,
  type OfferValue,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { QueueService, QUEUES } from '../queue/queue.service.js';

export interface OfferDraftInput {
  institutionId: string;
  programKey: string | null;
  type: OfferType;
  name: string;
  value: OfferValue;
  appliesTo: OfferBase;
  duration: OfferDuration;
  conditions: unknown[];
  exclusions: unknown[];
  termsSummary: string | null;
  applicationMethod: string | null;
  redemptionMethod: string | null;
  claimDeadline: string | null;
  validFrom: string;
  validUntil: string;
  sourceRef: string | null;
}

/** The columns that carry the value, split out of the discriminated union. */
function valueColumns(value: OfferValue) {
  return {
    valueKind: value.kind,
    basisPoints: value.kind === 'percentage' ? value.basisPoints : null,
    amountMinor: value.kind === 'fixed_amount' ? value.amount.amountMinor : null,
    currency: value.kind === 'fixed_amount' ? value.amount.currency : null,
    benefit: value.kind === 'benefit_in_kind' ? value.benefit : null,
    provider: value.kind === 'benefit_in_kind' ? value.provider : null,
  };
}

type OfferRow = Prisma.OfferGetPayload<{ include: { exclusions: true } }>;

/** Back from columns to the contract's union. Read paths go through this. */
export function rowValue(row: {
  valueKind: string;
  basisPoints: number | null;
  amountMinor: number | null;
  currency: string | null;
  benefit: string | null;
  provider: string | null;
}): OfferValue {
  switch (row.valueKind) {
    case 'percentage':
      return { kind: 'percentage', basisPoints: row.basisPoints! };
    case 'fixed_amount':
      return {
        kind: 'fixed_amount',
        amount: { amountMinor: row.amountMinor!, currency: row.currency! },
      };
    case 'benefit_in_kind':
      return { kind: 'benefit_in_kind', benefit: row.benefit!, provider: row.provider! };
    default:
      return { kind: 'full_waiver' };
  }
}

export function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    offerKey: row.offerKey,
    version: row.version,
    institutionId: row.institutionId,
    programKey: row.programKey,
    type: row.type,
    name: row.name,
    value: rowValue(row),
    appliesTo: row.appliesTo,
    duration: row.duration,
    conditions: row.conditions as Offer['conditions'],
    exclusions: row.exclusions.map((exclusion) => ({
      kind: exclusion.kind,
      otherOfferKey: exclusion.otherOfferKey,
      otherOfferType: exclusion.otherOfferType,
      programKeys: exclusion.programKeys,
      humanSummary: exclusion.humanSummary,
    })),
    termsSummary: row.termsSummary,
    applicationMethod: row.applicationMethod,
    redemptionMethod: row.redemptionMethod,
    claimDeadline: row.claimDeadline === null ? null : row.claimDeadline.toISOString(),
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    publicationState: row.publicationState,
    verificationState: row.verificationState,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt === null ? null : row.lastCheckedAt.toISOString(),
    sourceRef: row.sourceRef,
  };
}

/**
 * Offers (Phase 5, FR-013).
 *
 * The pipeline is source → eligibility validation → moderation → publish →
 * expiry, and this service owns the first four. Three things it deliberately
 * does **not** let happen:
 *
 *  1. **A university cannot publish its own offer.** `verify` needs
 *     `offer:verify`, which only Trust holds, and `publish` refuses anything
 *     that is not already verified. Self-verification is exactly the failure the
 *     institution pipeline exists to prevent one phase earlier, and a discount
 *     is a stronger incentive to cut the corner than a programme description is.
 *  2. **An edit does not rewrite history.** Editing writes a new effective-dated
 *     version, so an application that referenced version 2 still resolves to
 *     version 2 after the partner halves the award in June.
 *  3. **A published offer cannot be incomplete.** The blocker list is checked
 *     here *and* by a CHECK constraint, because a guarantee that depends on a
 *     service remembering is not a guarantee.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /** Everything a university admin sees for their own institution. */
  async listForInstitution(access: AccessContext, institutionId: string, now = new Date()) {
    this.assertInstitutionScope(access, institutionId);

    const rows = await this.prisma.offer.findMany({
      where: { institutionId, effectiveTo: null },
      include: { exclusions: true, _count: { select: { attachments: true } } },
      orderBy: [{ publicationState: 'asc' }, { validUntil: 'asc' }],
    });

    return rows.map((row) => ({
      ...toOffer(row),
      attachedApplications: row._count.attachments,
      live: isOfferLive(toOffer(row), now),
      expiryUrgency: offerExpiryUrgency(row.validUntil.toISOString(), now),
      blockers: canPublishOffer(toOffer(row)).blockers,
    }));
  }

  /** One offer, by key, at its current version. */
  async current(offerKey: string) {
    const row = await this.prisma.offer.findFirst({
      where: { offerKey, effectiveTo: null },
      include: { exclusions: true },
    });
    if (row === null) throw AppError.notFound('Offer');
    return row;
  }

  /**
   * Creates a draft.
   *
   * Conditions and exclusions are parsed through the contract before they touch
   * the database, for the same reason a requirement is: a rule the engine cannot
   * read is refused at write time, never stored and discovered at read time when
   * it would have to become an "unknown" on a student's price breakdown.
   */
  async createDraft(access: AccessContext, offerKey: string, input: OfferDraftInput) {
    this.assertInstitutionScope(access, input.institutionId);

    const existing = await this.prisma.offer.findFirst({ where: { offerKey } });
    if (existing !== null) {
      throw AppError.validation(`An offer with the key "${offerKey}" already exists.`, [
        { field: 'offerKey', code: 'conflict', message: 'Offer keys are unique across versions.' },
      ]);
    }

    const conditions = input.conditions.map((condition) => OfferConditionSchema.parse(condition));
    const exclusions = input.exclusions.map((exclusion) => OfferExclusionSchema.parse(exclusion));
    OfferValueSchema.parse(input.value);

    const row = await this.prisma.offer.create({
      data: {
        offerKey,
        institutionId: input.institutionId,
        programKey: input.programKey,
        type: input.type,
        name: input.name,
        ...valueColumns(input.value),
        appliesTo: input.appliesTo,
        duration: input.duration,
        conditions: conditions as unknown as Prisma.InputJsonValue,
        termsSummary: input.termsSummary,
        applicationMethod: input.applicationMethod,
        redemptionMethod: input.redemptionMethod,
        claimDeadline: input.claimDeadline === null ? null : new Date(input.claimDeadline),
        validFrom: new Date(input.validFrom),
        validUntil: new Date(input.validUntil),
        sourceRef: input.sourceRef,
        syncState: 'manual',
        reviewedBy: access.userId,
        staleFields: [],
        exclusions: { create: exclusions.map(toExclusionRow) },
      },
      include: { exclusions: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'offer.created',
      objectType: 'offer',
      objectId: row.id,
      metadata: { offerKey, type: input.type, institutionId: input.institutionId },
    });

    return toOffer(row);
  }

  /**
   * Edits an offer by superseding it.
   *
   * **Acceptance criterion: an offer edit does not retroactively change what an
   * existing application referenced.** That is true here because nothing is
   * updated in place — the current version is closed at `now`, the next one
   * opens at `now`, and every `ApplicationOffer` keeps pointing at the row it
   * was attached to.
   *
   * The new version starts unverified. Re-verification is the whole point: an
   * edit is a claim about what the university now says, and nobody has checked
   * it yet.
   */
  async supersede(
    access: AccessContext,
    offerKey: string,
    changes: Partial<OfferDraftInput>,
    now = new Date(),
  ) {
    const current = await this.current(offerKey);
    this.assertInstitutionScope(access, current.institutionId);

    const conditions =
      changes.conditions === undefined
        ? (current.conditions as unknown as Prisma.InputJsonValue)
        : (changes.conditions.map((condition) =>
            OfferConditionSchema.parse(condition),
          ) as unknown as Prisma.InputJsonValue);

    const exclusions =
      changes.exclusions === undefined
        ? current.exclusions.map((exclusion) => ({
            kind: exclusion.kind,
            otherOfferKey: exclusion.otherOfferKey,
            otherOfferType: exclusion.otherOfferType,
            programKeys: exclusion.programKeys,
            humanSummary: exclusion.humanSummary,
          }))
        : changes.exclusions.map((exclusion) => OfferExclusionSchema.parse(exclusion));

    const value = changes.value ?? rowValue(current);
    OfferValueSchema.parse(value);

    const next = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.offer.updateMany({
        where: { id: current.id, effectiveTo: null },
        data: { effectiveTo: now },
      });
      // Compare-and-set on `effectiveTo`: two concurrent edits would otherwise
      // both read the same current version and both open a new one, leaving two
      // rows with `effectiveTo === null` and no current version at all.
      if (closed.count === 0) {
        throw new AppError(
          'conflict',
          'Somebody else edited this offer while you were working on it. Reload and try again.',
        );
      }

      return tx.offer.create({
        data: {
          offerKey,
          institutionId: current.institutionId,
          programKey: changes.programKey === undefined ? current.programKey : changes.programKey,
          type: changes.type ?? current.type,
          name: changes.name ?? current.name,
          ...valueColumns(value),
          appliesTo: changes.appliesTo ?? current.appliesTo,
          duration: changes.duration ?? current.duration,
          conditions,
          termsSummary:
            changes.termsSummary === undefined ? current.termsSummary : changes.termsSummary,
          applicationMethod:
            changes.applicationMethod === undefined
              ? current.applicationMethod
              : changes.applicationMethod,
          redemptionMethod:
            changes.redemptionMethod === undefined
              ? current.redemptionMethod
              : changes.redemptionMethod,
          claimDeadline:
            changes.claimDeadline === undefined
              ? current.claimDeadline
              : changes.claimDeadline === null
                ? null
                : new Date(changes.claimDeadline),
          validFrom:
            changes.validFrom === undefined ? current.validFrom : new Date(changes.validFrom),
          validUntil:
            changes.validUntil === undefined ? current.validUntil : new Date(changes.validUntil),
          sourceRef: changes.sourceRef === undefined ? current.sourceRef : changes.sourceRef,
          // An edited offer is an unverified offer, and an unverified offer is
          // not published. Carrying the old verification forward would let a
          // partner turn a checked 10% into an unchecked 2% without anyone
          // looking at it again.
          publicationState: 'draft',
          verificationState: 'unverified',
          verifiedBy: null,
          verifiedAt: null,
          lastCheckedAt: current.lastCheckedAt,
          syncState: 'manual',
          reviewedBy: access.userId,
          staleFields: [],
          version: current.version + 1,
          effectiveFrom: now,
          effectiveTo: null,
          exclusions: { create: exclusions.map(toExclusionRow) },
        },
        include: { exclusions: true },
      });
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'offer.superseded',
      objectType: 'offer',
      objectId: next.id,
      metadata: {
        offerKey,
        fromVersion: current.version,
        toVersion: next.version,
        previousOfferId: current.id,
        wasPublished: current.publicationState === 'published',
      },
    });

    // Anyone holding the old version keeps it — that is the point — but the
    // offer they can newly claim is the new one, so the student is told.
    if (current.publicationState === 'published') {
      await this.notifyAttachedStudents(current.id, 'offer-changed', {
        offerKey,
        fromVersion: current.version,
        toVersion: next.version,
      });
    }

    return toOffer(next);
  }

  /**
   * Trust signs the offer off. **Not** the university — see the class comment.
   *
   * `lastCheckedAt` is set here rather than left to the caller: verification
   * means somebody looked at the source today, and a verifier who could pass a
   * date would eventually pass one they did not earn.
   */
  async verify(
    access: AccessContext,
    offerKey: string,
    decision: { verified: boolean; verifierName: string; note?: string },
    now = new Date(),
  ) {
    const current = await this.current(offerKey);

    const updated = await this.prisma.offer.update({
      where: { id: current.id },
      data: {
        verificationState: decision.verified ? 'verified' : 'unverified',
        verifiedBy: decision.verified ? decision.verifierName : null,
        verifiedAt: decision.verified ? now : null,
        lastCheckedAt: now,
        publicationState: decision.verified ? 'in_review' : 'draft',
        syncState: 'manual',
        reviewedBy: access.userId,
      },
      include: { exclusions: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'offer.verified',
      objectType: 'offer',
      objectId: current.id,
      metadata: { offerKey, verified: decision.verified, note: decision.note ?? null },
    });

    return toOffer(updated);
  }

  /**
   * Publishes. Refuses, with the list, if anything required is missing.
   *
   * Acceptance criterion 1 lives here and in the `offers_publishable` CHECK
   * constraint. Two enforcements of one rule is not redundancy: this one can
   * explain what is wrong, and that one cannot be bypassed.
   */
  async publish(access: AccessContext, offerKey: string, now = new Date()) {
    const current = await this.current(offerKey);
    this.assertInstitutionScope(access, current.institutionId);

    const offer = toOffer(current);
    const gate = canPublishOffer(offer);
    if (!gate.ok) {
      throw AppError.validation(
        'This offer is not complete enough to publish. A student has to be able to check every number on it.',
        gate.blockers.map((blocker, index) => ({
          field: `offer.${index}`,
          code: 'incomplete',
          message: blocker,
        })),
      );
    }

    if (new Date(offer.validUntil).getTime() <= now.getTime()) {
      throw AppError.validation('This offer has already expired; publishing it would show a student a deadline that has passed.', [
        { field: 'validUntil', code: 'expired', message: `The validity window closed on ${offer.validUntil}.` },
      ]);
    }

    const updated = await this.prisma.offer.update({
      where: { id: current.id },
      data: { publicationState: 'published', unpublishedAt: null, unpublishedReason: null, syncState: 'synced' },
      include: { exclusions: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'offer.published',
      objectType: 'offer',
      objectId: current.id,
      metadata: { offerKey, type: offer.type, value: OFFER_TYPE_LABELS[offer.type] },
    });

    return toOffer(updated);
  }

  /**
   * Pulls an offer. Used by the admin screen, by the expiry sweep and by the
   * mismatch pipeline, so it takes an explicit reason and an explicit actor
   * rather than reading either from the request.
   */
  async unpublish(
    actor: Parameters<AuditService['record']>[0]['actor'],
    offerId: string,
    reason: string,
    state: 'unpublished' | 'expired' = 'unpublished',
    now = new Date(),
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const updated = await client.offer.updateMany({
      where: { id: offerId, publicationState: 'published' },
      data: { publicationState: state, unpublishedAt: now, unpublishedReason: reason },
    });
    if (updated.count === 0) return false;

    await this.audit.record({
      actor,
      action: 'offer.unpublished',
      objectType: 'offer',
      objectId: offerId,
      metadata: { reason, state },
    });
    return true;
  }

  /**
   * Tells every student holding this offer that something happened to it.
   *
   * "Impacted users are notified" is an acceptance criterion for expiry, and the
   * same courtesy applies to an edit: a student who priced their year on an
   * award finds out from us, not from the university's finance office.
   */
  async notifyAttachedStudents(
    offerId: string,
    job: string,
    metadata: Record<string, unknown>,
  ): Promise<number> {
    const attachments = await this.prisma.applicationOffer.findMany({
      where: { offerId, state: { in: ['attached', 'accepted'] } },
      include: { application: { select: { id: true, studentId: true } } },
    });

    for (const attachment of attachments) {
      await this.queue.enqueue(QUEUES.notifications, job, {
        studentId: attachment.application.studentId,
        applicationId: attachment.application.id,
        offerId,
        offerKey: attachment.offerKey,
        ...metadata,
      });
    }
    return attachments.length;
  }

  /**
   * A university actor may only touch its own institution.
   *
   * Ops and superadmin have no `organisationId`, and they are the exception by
   * design — an offer a partner cannot fix themselves has to be fixable by
   * somebody.
   */
  private assertInstitutionScope(access: AccessContext, institutionId: string): void {
    if (access.organisationId === null) return;
    if (access.organisationId !== institutionId) {
      throw AppError.forbidden('This offer belongs to another institution.');
    }
  }
}

function toExclusionRow(exclusion: OfferExclusion) {
  return {
    kind: exclusion.kind,
    otherOfferKey: exclusion.otherOfferKey,
    otherOfferType: exclusion.otherOfferType,
    programKeys: exclusion.programKeys,
    humanSummary: exclusion.humanSummary,
  };
}
