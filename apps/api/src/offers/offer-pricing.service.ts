import { Injectable } from '@nestjs/common';
import {
  computePriceBreakdown,
  isOfferLive,
  isRenderableOffer,
  money,
  offerExpiryUrgency,
  rollUpVerdict,
  type EligibilityCheck,
  type IneligibleOffer,
  type Money,
  type OfferCondition,
  type PriceBreakdown,
  type PriceableOffer,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { EligibilityService, type RuleSetInput } from '../eligibility/eligibility.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toOffer } from './offers.service.js';

export interface OfferView extends PriceableOffer {
  offerId: string;
  eligible: boolean;
  /** Every condition, with its outcome — not just the ones that failed. */
  checks: EligibilityCheck[];
  verifiedBy: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  sourceUpdatedAt: string | null;
  syncState: string;
  reviewedBy: string | null;
  termsSummary: string | null;
  applicationMethod: string | null;
  redemptionMethod: string | null;
  claimDeadline: string | null;
  expiryUrgency: ReturnType<typeof offerExpiryUrgency>;
}

export interface ProgrammePricing {
  programKey: string;
  breakdown: PriceBreakdown;
  offers: OfferView[];
  /** Null when the university has published no fees — we never estimate them. */
  tuition: Money | null;
}

/**
 * The student-facing price calculation (Phase 5 §3, FR-014).
 *
 * The single rule: **a net price is only ever computed from offers whose
 * eligibility rules are actually satisfied.** Everything else in this service
 * follows from refusing to bend that — an offer with a `missing_data` condition
 * is not eligible, it is unassessed, and it appears in the list with the thing
 * the student would have to add rather than silently inside the number.
 *
 * Conditions run through `EligibilityService.explainRuleSets`, which is the same
 * engine and the same evaluators the programme page uses.
 */
@Injectable()
export class OfferPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: EligibilityService,
  ) {}

  /**
   * Prices one programme for one student.
   *
   * `userId` may be null. An anonymous visitor sees every offer, with every
   * condition unassessed and a net price equal to the gross — which is honest,
   * and is the opposite of the usual pattern of showing the best possible
   * discount to somebody who has not been checked against anything.
   */
  async priceProgramme(
    programKey: string,
    userId: string | null,
    now: Date = new Date(),
  ): Promise<ProgrammePricing> {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: { fees: true, institution: { select: { id: true } } },
    });
    if (program === null) throw AppError.notFound('Programme');

    const offers = await this.liveOffers(program.institution.id, programKey, now);
    const views = await this.evaluate(offers, userId, now);

    const fees = program.fees[0];
    if (fees === undefined) {
      // No published fees, so no net price. The offers are still listed with
      // their conditions: "we do not know the tuition" is not a reason to hide
      // a scholarship a student could apply for today.
      return {
        programKey,
        tuition: null,
        offers: views,
        breakdown: emptyBreakdown(now),
      };
    }

    const tuition = money(fees.tuitionMinor, fees.tuitionCurrency);
    const breakdown = computePriceBreakdown({
      tuition,
      applicationFee:
        fees.applicationFeeMinor === null || fees.applicationFeeCurrency === null
          ? null
          : money(fees.applicationFeeMinor, fees.applicationFeeCurrency),
      deposit:
        fees.depositMinor === null || fees.depositCurrency === null
          ? null
          : money(fees.depositMinor, fees.depositCurrency),
      eligible: views.filter((view) => view.eligible),
      ineligible: views.filter((view) => !view.eligible).map(toIneligible),
      now,
    });

    return { programKey, tuition, offers: views, breakdown };
  }

  /**
   * The offers that may be shown at all.
   *
   * `isOfferLive` is applied in memory after the query rather than folded into
   * it: the query narrows by the indexed columns, and the contract decides
   * liveness, so a page and a sweep running a second apart cannot disagree about
   * whether an offer that lapsed between them is live.
   */
  async liveOffers(institutionId: string, programKey: string | null, now: Date) {
    const rows = await this.prisma.offer.findMany({
      where: {
        institutionId,
        effectiveTo: null,
        publicationState: 'published',
        ...(programKey === null ? {} : { OR: [{ programKey }, { programKey: null }] }),
      },
      include: { exclusions: true },
    });

    return rows
      .map(toOffer)
      .filter((offer) => isOfferLive(offer, now))
      // Enforced again on the way out of the API, not only in the component: a
      // card that refuses to render is a good last line, and a payload that
      // never carries an unverifiable offer is a better first one.
      .filter(isRenderableOffer)
      .filter((offer) => !excludedProgramme(offer.exclusions, programKey));
  }

  /**
   * Runs each offer's conditions through the programme eligibility engine and
   * turns the checks into "eligible" or "here is the condition you do not meet".
   *
   * An offer with no `fail` and no `missing_data` is eligible. Anything else is
   * not — and `rollUpVerdict` is the same roll-up the programme verdict uses, so
   * the two surfaces cannot disagree about what an unassessed rule means.
   */
  async evaluate(
    offers: readonly ReturnType<typeof toOffer>[],
    userId: string | null,
    now: Date,
  ): Promise<OfferView[]> {
    const groups = new Map<string, RuleSetInput[]>();
    for (const offer of offers) {
      groups.set(
        offer.id,
        (offer.conditions as OfferCondition[]).map((condition) => ({
          id: condition.id,
          ruleType: condition.ruleType,
          ruleJson: condition.ruleJson,
          humanSummary: condition.humanSummary,
          sourceRef: condition.sourceRef,
        })),
      );
    }

    const explained = await this.eligibility.explainRuleSets(userId, groups, now);

    return offers.map((offer) => {
      const checks = explained.get(offer.id) ?? [];
      const verdict = rollUpVerdict(checks);
      return {
        offerId: offer.id,
        offerKey: offer.offerKey,
        version: offer.version,
        name: offer.name,
        type: offer.type,
        value: offer.value,
        appliesTo: offer.appliesTo,
        duration: offer.duration,
        exclusions: offer.exclusions,
        sourceRef: offer.sourceRef,
        programKey: offer.programKey,
        validUntil: offer.validUntil,
        eligible: verdict === 'eligible',
        checks,
        verifiedBy: offer.verifiedBy,
        verifiedAt: offer.verifiedAt,
        lastCheckedAt: offer.lastCheckedAt,
        sourceUpdatedAt: offer.verifiedAt,
        syncState: 'synced',
        reviewedBy: offer.verifiedBy,
        termsSummary: offer.termsSummary,
        applicationMethod: offer.applicationMethod,
        redemptionMethod: offer.redemptionMethod,
        claimDeadline: offer.claimDeadline,
        expiryUrgency: offerExpiryUrgency(offer.validUntil, now),
      };
    });
  }
}

/**
 * The specific unmet condition, never a summary.
 *
 * Same rule as an ineligible programme: explain, do not hide. The first `fail`
 * is the reason; if nothing failed, the first gap is — and a gap carries the
 * remedy, so "you might qualify, add your transcript" reads as the invitation it
 * is rather than as a rejection.
 *
 * A failed check is stated as the **offer's own condition** plus what the
 * profile says, rather than as the engine's sentence. The engine is shared with
 * the programme surface and its wording says "this programme", which is simply
 * false on a scholarship card — and a student who reads "this programme does not
 * accept applications from nationals of NG" beside a course they *are* eligible
 * for has been told something untrue about the thing that matters most. Every
 * other outcome keeps the engine's words, because there the two surfaces really
 * do mean the same thing.
 */
function toIneligible(view: OfferView): IneligibleOffer {
  const failed = view.checks.find((check) => check.outcome === 'fail');
  const missing = view.checks.find((check) => check.outcome === 'missing_data');
  const unknown = view.checks.find((check) => check.outcome === 'unknown');
  const decisive = failed ?? missing ?? unknown ?? null;

  return {
    offerId: view.offerId,
    offerKey: view.offerKey,
    name: view.name,
    unmetCondition:
      decisive === null
        ? 'We could not check the conditions on this offer.'
        : decisive === failed
          ? `This offer requires: ${decisive.requirement}` +
            (decisive.studentValue === null ? '' : ` Your profile says ${decisive.studentValue}.`)
          : decisive.reason,
    remedy: decisive?.remedy ?? null,
    outcome: failed !== undefined ? 'fail' : missing !== undefined ? 'missing_data' : 'unknown',
  };
}

function excludedProgramme(
  exclusions: readonly { kind: string; programKeys: string[] }[],
  programKey: string | null,
): boolean {
  if (programKey === null) return false;
  return exclusions.some(
    (exclusion) =>
      exclusion.kind === 'excludes_programmes' && exclusion.programKeys.includes(programKey),
  );
}

function emptyBreakdown(now: Date): PriceBreakdown {
  const zero = money(0, 'GBP');
  return {
    currency: 'GBP',
    lines: [],
    grossTotal: zero,
    totalSaving: zero,
    netPrice: zero,
    applied: [],
    suppressed: [],
    ineligible: [],
    unpriceable: [],
    computedAt: now.toISOString(),
  };
}
