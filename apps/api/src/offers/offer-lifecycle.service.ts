import { Injectable, Logger } from '@nestjs/common';
import {
  AdmissionConditionSchema,
  admissionOfferSummary,
  canTransitionAttachment,
  isOfferLive,
  money,
  savingFor,
  savingsSecured,
  type AccessContext,
  type AdmissionOfferKind,
  type Money,
  type OfferAttachmentState,
  type RealisedSaving,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor, toAuditActor } from '../auth/audit-actor.js';
import { rowValue, toOffer } from './offers.service.js';
import { OfferPricingService } from './offer-pricing.service.js';

/**
 * Offers on an application (Phase 5 §4).
 *
 * Two things are kept apart here with some determination:
 *
 *  * **Marketing offers** — scholarships, discounts, waivers — attach to an
 *    application, carry a frozen value, and move `attached → accepted /
 *    declined / expired / realised`.
 *  * **The admission offer** — the university's decision — is a different table,
 *    a different vocabulary and a different method. A conditional admission
 *    offer is not a scholarship, and nothing in this file lets one be read as
 *    the other.
 *
 * "Savings secured" counts the intersection of *verified* and *realised at
 * enrolment*, and `realise` is the only thing that writes `realisedAt`.
 */
@Injectable()
export class OfferLifecycleService {
  private readonly logger = new Logger(OfferLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: OfferPricingService,
  ) {}

  /**
   * Attaches an offer to an application, freezing what it was worth.
   *
   * The freeze is two-part and both halves matter: `offerId` pins the
   * effective-dated *version*, so a later edit cannot change what this
   * application referenced, and the value columns are a copy, so the receipt
   * survives even a retention sweep that removes the offer row.
   */
  async attach(
    access: AccessContext,
    applicationId: string,
    offerKey: string,
    now: Date = new Date(),
  ) {
    const application = await this.owned(access, applicationId);
    const row = await this.prisma.offer.findFirst({
      where: { offerKey, effectiveTo: null },
      include: { exclusions: true },
    });
    if (row === null) throw AppError.notFound('Offer');

    const offer = toOffer(row);
    if (!isOfferLive(offer, now)) {
      throw AppError.validation('That offer is not currently available.', [
        {
          field: 'offerKey',
          code: 'not_live',
          message:
            offer.publicationState === 'published'
              ? `This offer's validity window closed on ${offer.validUntil}.`
              : 'This offer is not published.',
        },
      ]);
    }
    if (row.institutionId !== application.institutionId) {
      throw AppError.validation('That offer belongs to a different university.', [
        { field: 'offerKey', code: 'wrong_institution', message: 'Offers are institution-scoped.' },
      ]);
    }

    // Eligibility is re-checked at attachment, against this student, now. The
    // price panel checked it too — but that was a read, and this is the moment
    // the claim gets written down.
    const [view] = await this.pricing.evaluate([offer], application.studentId, now);
    if (view === undefined || !view.eligible) {
      const unmet = view?.checks.find((check) => check.outcome !== 'pass');
      throw AppError.validation('You do not meet the conditions on this offer yet.', [
        {
          field: 'offerKey',
          code: 'not_eligible',
          message: unmet?.reason ?? 'We could not confirm you meet the conditions.',
        },
      ]);
    }

    const saving = await this.savingAgainst(application.programKey, offer, now);

    const attachment = await this.prisma.applicationOffer.create({
      data: {
        applicationId,
        offerId: offer.id,
        offerKey,
        valueKind: row.valueKind,
        basisPoints: row.basisPoints,
        amountMinor: row.amountMinor,
        currency: row.currency,
        savingMinor: saving?.amountMinor ?? null,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'offer.attached',
      objectType: 'application',
      objectId: applicationId,
      metadata: {
        offerKey,
        offerId: offer.id,
        offerVersion: offer.version,
        savingMinor: saving?.amountMinor ?? null,
        currency: saving?.currency ?? null,
      },
    });

    return attachment;
  }

  /** The student's decision on a marketing offer. Never on an admission offer. */
  async respond(
    access: AccessContext,
    applicationId: string,
    offerKey: string,
    decision: 'accepted' | 'declined',
    now: Date = new Date(),
  ) {
    await this.owned(access, applicationId);
    return this.transition(toAuditActor(access), applicationId, offerKey, decision, now);
  }

  /**
   * Moves one attachment, refusing anything the lifecycle does not allow.
   *
   * The table lives in the contracts package so the illegal hops — `attached →
   * realised` without an acceptance, anything out of `declined` — are walked by
   * a unit test rather than discovered in production.
   */
  async transition(
    actor: AuditActor,
    applicationId: string,
    offerKey: string,
    to: OfferAttachmentState,
    now: Date = new Date(),
  ) {
    const attachment = await this.prisma.applicationOffer.findUnique({
      where: { applicationId_offerKey: { applicationId, offerKey } },
    });
    if (attachment === null) throw AppError.notFound('Offer on this application');

    const from = attachment.state as OfferAttachmentState;
    if (!canTransitionAttachment(from, to)) {
      throw AppError.stateTransition(`An offer that is ${from} cannot become ${to}.`, { from, to });
    }

    const updated = await this.prisma.applicationOffer.updateMany({
      where: { id: attachment.id, state: from },
      data: {
        state: to,
        ...(to === 'accepted' || to === 'declined' ? { respondedAt: now } : {}),
        ...(to === 'expired' ? { expiredAt: now } : {}),
        ...(to === 'realised' ? { realisedAt: now } : {}),
      },
    });
    if (updated.count === 0) {
      throw new AppError('conflict', 'This offer changed while we were updating it. Reload and try again.');
    }

    await this.audit.record({
      actor,
      action: 'offer.attachment_changed',
      objectType: 'application',
      objectId: applicationId,
      metadata: { offerKey, from, to },
    });

    return { offerKey, from, to };
  }

  /**
   * Enrolment: the only thing that writes `realisedAt`.
   *
   * Called when the university tells us the student enrolled. Only *accepted*
   * attachments are realised — an award the student never accepted was never a
   * saving, and counting it would make the success metric a marketing number
   * with an audit trail, which is the worst of both.
   */
  async realiseAtEnrolment(applicationId: string, now: Date = new Date()): Promise<number> {
    const accepted = await this.prisma.applicationOffer.findMany({
      where: { applicationId, state: 'accepted' },
      select: { offerKey: true },
    });

    let realised = 0;
    for (const attachment of accepted) {
      try {
        await this.transition(systemActor(), applicationId, attachment.offerKey, 'realised', now);
        realised += 1;
      } catch (error) {
        // One award that will not move must not stop the others, and must not
        // fail the enrolment event that triggered this.
        this.logger.warn(
          `Could not realise ${attachment.offerKey} on ${applicationId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return realised;
  }

  /**
   * Records the university's **admission** decision.
   *
   * Its own table, and deliberately no `state` column shared with anything: the
   * application's own state machine already says where the application is, and a
   * second one here would be two answers to one question.
   */
  async recordAdmissionOffer(
    actor: AuditActor,
    applicationId: string,
    input: {
      kind: AdmissionOfferKind;
      conditions: unknown[];
      issuedAt: string;
      respondByAt?: string | null;
      externalRef?: string | null;
      notes?: string | null;
    },
  ) {
    const conditions = input.conditions.map((condition) => AdmissionConditionSchema.parse(condition));

    const record = await this.prisma.admissionOffer.upsert({
      where: { applicationId },
      create: {
        applicationId,
        kind: input.kind,
        conditions: conditions as object[],
        issuedAt: new Date(input.issuedAt),
        respondByAt: input.respondByAt == null ? null : new Date(input.respondByAt),
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      },
      update: {
        kind: input.kind,
        conditions: conditions as object[],
        issuedAt: new Date(input.issuedAt),
        respondByAt: input.respondByAt == null ? null : new Date(input.respondByAt),
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
      },
    });

    await this.audit.record({
      actor,
      action: 'application.admission_offer_recorded',
      objectType: 'application',
      objectId: applicationId,
      metadata: {
        kind: input.kind,
        conditions: conditions.length,
        outstanding: conditions.filter((condition) => !condition.met).length,
      },
    });

    return record;
  }

  /** Everything on one application: attachments, the admission offer, savings. */
  async forApplication(access: AccessContext, applicationId: string) {
    const application = await this.readable(access, applicationId);

    const attachments = await this.prisma.applicationOffer.findMany({
      where: { applicationId },
      include: { offer: { include: { exclusions: true } } },
      orderBy: { attachedAt: 'asc' },
    });

    const admission = await this.prisma.admissionOffer.findUnique({ where: { applicationId } });

    return {
      applicationId,
      offers: attachments.map((attachment) => ({
        offerKey: attachment.offerKey,
        offerId: attachment.offerId,
        offerVersion: attachment.offer.version,
        name: attachment.offer.name,
        type: attachment.offer.type,
        state: attachment.state,
        // The value as it was when attached — not as the offer reads today.
        // The frozen columns carry no benefit/provider, so those come off the
        // offer: a benefit in kind has no amount to freeze in the first place.
        value: rowValue({
          ...attachment,
          benefit: attachment.offer.benefit,
          provider: attachment.offer.provider,
        }),
        savingMinor: attachment.savingMinor,
        currency: attachment.currency ?? attachment.offer.currency,
        sourceRef: attachment.offer.sourceRef,
        attachedAt: attachment.attachedAt.toISOString(),
        respondedAt: attachment.respondedAt?.toISOString() ?? null,
        expiredAt: attachment.expiredAt?.toISOString() ?? null,
        realisedAt: attachment.realisedAt?.toISOString() ?? null,
      })),
      admissionOffer:
        admission === null
          ? null
          : {
              kind: admission.kind,
              conditions: admission.conditions,
              issuedAt: admission.issuedAt.toISOString(),
              respondByAt: admission.respondByAt?.toISOString() ?? null,
              externalRef: admission.externalRef,
              summary: admissionOfferSummary({
                applicationId,
                kind: admission.kind,
                conditions: admission.conditions as { summary: string; met: boolean; evidence: string | null }[],
                issuedAt: admission.issuedAt.toISOString(),
                respondByAt: admission.respondByAt?.toISOString() ?? null,
                externalRef: admission.externalRef,
                notes: admission.notes,
              }),
            },
      studentId: application.studentId,
    };
  }

  /**
   * The **scholarship savings** metric (epic §1).
   *
   * Counts verified offers realised at enrolment, and nothing else. Grouped by
   * currency rather than summed across them, because a total that mixed pounds
   * and euros would be a number with no unit dressed as a result.
   */
  async savingsReport(filters: { institutionId?: string; studentId?: string } = {}) {
    const attachments = await this.prisma.applicationOffer.findMany({
      where: {
        state: 'realised',
        ...(filters.studentId === undefined
          ? {}
          : { application: { studentId: filters.studentId } }),
        ...(filters.institutionId === undefined
          ? {}
          : { offer: { institutionId: filters.institutionId } }),
      },
      include: {
        offer: { select: { verificationState: true, currency: true, institutionId: true } },
      },
    });

    const currencies = new Set<string>();
    const entries: RealisedSaving[] = attachments.map((attachment) => {
      const currency = attachment.currency ?? attachment.offer.currency ?? 'GBP';
      currencies.add(currency);
      return {
        offerId: attachment.offerId,
        offerKey: attachment.offerKey,
        state: attachment.state,
        verificationState: attachment.offer.verificationState,
        amount: attachment.savingMinor === null ? null : money(attachment.savingMinor, currency),
      };
    });

    return {
      realisedCount: entries.filter(
        (entry) => entry.state === 'realised' && entry.verificationState === 'verified',
      ).length,
      byCurrency: [...currencies]
        .sort()
        .map((currency) => ({ currency, total: savingsSecured(entries, currency) })),
    };
  }

  /**
   * What one offer is worth against the programme this application is for.
   *
   * Computed here rather than taken from whatever the page happened to show,
   * which is the difference between a frozen figure and a remembered one.
   */
  private async savingAgainst(
    programKey: string,
    offer: ReturnType<typeof toOffer>,
    now: Date,
  ): Promise<Money | null> {
    if (offer.appliesTo === 'none') return null;
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: { fees: true },
    });
    const fees = program?.fees[0];
    if (fees === undefined) return null;

    const base =
      offer.appliesTo === 'tuition'
        ? money(fees.tuitionMinor, fees.tuitionCurrency)
        : offer.appliesTo === 'application_fee'
          ? fees.applicationFeeMinor === null || fees.applicationFeeCurrency === null
            ? null
            : money(fees.applicationFeeMinor, fees.applicationFeeCurrency)
          : fees.depositMinor === null || fees.depositCurrency === null
            ? null
            : money(fees.depositMinor, fees.depositCurrency);

    if (base === null) return null;
    if (offer.value.kind === 'fixed_amount' && offer.value.amount.currency !== base.currency) {
      // The breakdown refuses to convert, and so does the frozen figure.
      return null;
    }
    void now;
    return savingFor({ ...offer, offerId: offer.id }, base);
  }

  private async owned(access: AccessContext, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    // A 404 rather than a 403, for the same reason `ApplicationsService.owned`
    // gives one: a student probing ids must not be able to tell "not yours" from
    // "does not exist".
    if (application === null || application.studentId !== access.userId) {
      throw AppError.notFound('Application');
    }
    return application;
  }

  private async readable(access: AccessContext, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (application === null) throw AppError.notFound('Application');
    if (application.studentId === access.userId) return application;
    if (!access.permissions.has('application:read') || access.roles.includes('student')) {
      throw AppError.notFound('Application');
    }
    if (access.organisationId !== null && access.organisationId !== application.institutionId) {
      throw AppError.notFound('Application');
    }
    return application;
  }
}
