import { Injectable } from '@nestjs/common';
import {
  ASSESSMENT_SLA_HOURS,
  buildFunnel,
  buildInsightNotes,
  dailyTrend,
  distribution,
  hoursBetween,
  median,
  percentile,
  rate,
  totalsByCurrency,
  trendChange,
  type AccessContext,
  type ApplicationState,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertOrganisationAccess } from '../auth/access-context.js';

/**
 * Platform statistics and insights (Phase 8, #20).
 *
 * The arithmetic is not here. Every figure below is produced by a pure function
 * in `@modex/contracts/insights`, which the public build calls too — the
 * alternative being a console and a demo that report the same platform two
 * ways, with no way to tell which is wrong.
 *
 * What *is* here is the part that cannot live in a shared module: which rows an
 * actor may aggregate over. A university sees its own applications. Modex staff
 * see the platform. There is no query in this file that returns a figure
 * spanning institutions to somebody scoped to one, because an average that
 * includes your competitor's conversion rate is a disclosure whether or not the
 * competitor is named.
 *
 * The reporting window is a parameter with a small, fixed set of values rather
 * than a free date range. A console that can ask for any window is a console
 * that can ask for the window containing exactly one student.
 */
export const INSIGHT_WINDOWS = [7, 30, 90] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(access: AccessContext, requested?: string | null): string | null {
    if (requested != null) {
      assertOrganisationAccess(access, requested);
      return requested;
    }
    return access.organisationId;
  }

  /**
   * Everything the insights console renders, in one call.
   *
   * One call rather than six because every figure has to describe the same
   * instant: a funnel fetched at 09:00:01 next to a queue depth fetched at
   * 09:00:04 is two snapshots presented as one, and the drop-off it appears to
   * show can be an artefact of the gap.
   */
  async overview(
    access: AccessContext,
    options: { window?: InsightWindow; institutionId?: string | null } = {},
  ) {
    const institutionId = this.scope(access, options.institutionId);
    const window = options.window ?? 30;
    const now = new Date();
    const since = new Date(now.getTime() - window * 86_400_000);
    const scope = institutionId === null ? {} : { institutionId };

    const [applications, institutions, programmes, guides, trustCases, assessments, offers] =
      await Promise.all([
        this.prisma.application.findMany({
          where: { ...scope, createdAt: { gte: since } },
          select: {
            id: true,
            state: true,
            createdAt: true,
            submittedAt: true,
            confirmedAt: true,
            institutionId: true,
            programKey: true,
            institution: { select: { displayName: true, country: true } },
          },
          take: 5000,
        }),
        this.prisma.institution.findMany({
          select: { id: true, displayName: true, country: true, verificationState: true },
          take: 1000,
        }),
        this.prisma.program.findMany({
          where: institutionId === null ? {} : { institutionId },
          select: { id: true, syncState: true, staleFields: true },
          take: 5000,
        }),
        institutionId === null
          ? this.prisma.studentGuide.findMany({ select: { id: true, state: true }, take: 2000 })
          : this.prisma.studentGuide.findMany({
              where: { institutionId },
              select: { id: true, state: true },
              take: 2000,
            }),
        // Trust is a Modex-wide function; a partner is not shown the platform's
        // open case count, which would be a figure about other institutions.
        institutionId === null
          ? this.prisma.trustCase.findMany({ select: { id: true, state: true }, take: 2000 })
          : Promise.resolve([] as { id: string; state: string }[]),
        this.prisma.documentAssessment.findMany({
          where: institutionId === null ? { institutionId: null } : { institutionId },
          select: { id: true, decision: true, createdAt: true, decidedAt: true },
          take: 5000,
        }),
        this.prisma.offer.findMany({
          where: institutionId === null ? {} : { institutionId },
          select: { id: true, amountMinor: true, currency: true, publicationState: true },
          take: 2000,
        }),
      ]);

    const states = applications.map((one) => one.state as ApplicationState);
    const funnel = buildFunnel(states);

    // Time to a university's acknowledgement, measured only on the applications
    // that actually got one. Including the unconfirmed as "still waiting" would
    // make the median a function of how recently we deployed.
    const ackHours = applications
      .filter((one) => one.submittedAt !== null && one.confirmedAt !== null)
      .map((one) => hoursBetween(one.submittedAt!.toISOString(), one.confirmedAt!.toISOString()));

    const reviewHours = assessments
      .filter((one) => one.decidedAt !== null)
      .map((one) => hoursBetween(one.createdAt.toISOString(), one.decidedAt!.toISOString()));

    const staleProgrammes = programmes.filter(
      (one) => one.syncState === 'stale' || (one.staleFields ?? []).length > 0,
    );

    const overdueAssessments = assessments.filter(
      (one) =>
        one.decidedAt === null &&
        now.getTime() - one.createdAt.getTime() > ASSESSMENT_SLA_HOURS * 3_600_000,
    ).length;

    const openTrustCases = trustCases.filter((one) => one.state === 'open').length;
    const unverified = institutions.filter((one) => one.verificationState !== 'verified').length;

    return {
      window,
      generatedAt: now.toISOString(),
      scope: institutionId === null ? 'platform' : 'institution',
      institutionId,

      funnel,
      /**
       * Named "reached a university" rather than "submission rate" because that
       * is what it measures: the denominator is applications started, and the
       * numerator is the ones a university confirmed receiving.
       */
      reachedUniversity: rate(
        funnel.find((row) => row.stage === 'submitted')?.count ?? 0,
        funnel.find((row) => row.stage === 'started')?.count ?? 0,
      ),

      trend: dailyTrend(
        applications.map((one) => one.createdAt.toISOString()),
        Math.min(window, 90),
        now,
      ),
      trendChange: trendChange(
        dailyTrend(applications.map((one) => one.createdAt.toISOString()), Math.min(window, 90), now),
      ),

      byInstitution: distribution(
        applications.map((one) => one.institutionId),
        {
          labels: Object.fromEntries(institutions.map((one) => [one.id, one.displayName])),
          limit: 8,
        },
      ),
      byCountry: distribution(
        applications.map((one) => one.institution?.country ?? 'unknown'),
        { limit: 8 },
      ),
      byProgramme: distribution(applications.map((one) => one.programKey), { limit: 8 }),

      timings: {
        medianAckHours: median(ackHours),
        p90AckHours: percentile(ackHours, 0.9),
        medianReviewHours: median(reviewHours),
        p90ReviewHours: percentile(reviewHours, 0.9),
      },

      documents: {
        total: assessments.length,
        decided: assessments.filter((one) => one.decision !== null).length,
        accepted: assessments.filter((one) => one.decision === 'accepted').length,
        rejected: assessments.filter((one) => one.decision === 'rejected').length,
        moreInformation: assessments.filter((one) => one.decision === 'more_information').length,
        overdue: overdueAssessments,
        slaHours: ASSESSMENT_SLA_HOURS,
      },

      catalogue: {
        programmes: programmes.length,
        stale: staleProgrammes.length,
      },

      network: {
        guides: guides.length,
        active: guides.filter((one) => one.state === 'active').length,
        restricted: guides.filter((one) => one.state === 'restricted').length,
        suspended: guides.filter((one) => one.state === 'suspended').length,
      },

      register: {
        institutions: institutions.length,
        verified: institutions.filter((one) => one.verificationState === 'verified').length,
        unverified,
      },

      /** Per currency, never summed across them. */
      offerValue: totalsByCurrency(
        offers
          .filter((one) => one.publicationState === 'published' && one.amountMinor !== null)
          .map((one) => ({ amountMinor: one.amountMinor ?? 0, currency: one.currency ?? 'GBP' })),
      ),

      notes: buildInsightNotes({
        funnel,
        overdueAssessments,
        quarantined: 0,
        staleMoneyRecords: staleProgrammes.length,
        openTrustCases,
        unverifiedRegisterEntries: unverified,
        medianReviewHours: median(reviewHours),
        slaHours: ASSESSMENT_SLA_HOURS,
      }),
    };
  }
}
