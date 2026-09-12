import { Injectable } from '@nestjs/common';
import type { AccessContext } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';

/** How long a queue item may age before it is shown as breaching (hours). */
export const VERIFICATION_SLA_HOURS: Readonly<Record<string, number>> = Object.freeze({
  institution: 72,
  guide: 48,
  offer: 24,
});

/**
 * The trust console's read side (Phase 6 §2).
 *
 * Everything here is a queue, and every queue is sorted by how long the person
 * on the other end has been waiting rather than by when the row was created:
 * a verification queue ordered by id is a queue where the oldest case is the
 * one nobody ever sees.
 *
 * Evidence is the exception to every "reads are not audited" rule in this
 * codebase — see `evidenceFor`.
 */
@Injectable()
export class TrustConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Institutions, guides and offers waiting for a human, with SLA ageing. */
  async verificationQueue(now: Date = new Date()) {
    const [institutions, guides, offers] = await Promise.all([
      this.prisma.institution.findMany({
        where: { verificationState: 'pending' },
        select: {
          id: true,
          displayName: true,
          country: true,
          verificationStage: true,
          updatedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      this.prisma.studentGuide.findMany({
        where: { state: 'pending' },
        select: {
          id: true,
          stage: true,
          createdAt: true,
          updatedAt: true,
          institution: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      this.prisma.offer.findMany({
        where: { publicationState: 'in_review' },
        select: {
          id: true,
          name: true,
          verificationState: true,
          createdAt: true,
          updatedAt: true,
          institution: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    ]);

    return {
      institutions: institutions.map((row) => ({
        kind: 'institution' as const,
        id: row.id,
        label: row.displayName,
        detail: `${row.country} · ${row.verificationStage ?? 'not started'}`,
        waitingSince: row.createdAt.toISOString(),
        ageHours: ageHours(row.createdAt, now),
        breachingSla: ageHours(row.createdAt, now) > (VERIFICATION_SLA_HOURS.institution ?? 72),
      })),
      guides: guides.map((row) => ({
        kind: 'guide' as const,
        id: row.id,
        label: row.institution.displayName,
        detail: `stage: ${row.stage}`,
        waitingSince: row.createdAt.toISOString(),
        ageHours: ageHours(row.createdAt, now),
        breachingSla: ageHours(row.createdAt, now) > (VERIFICATION_SLA_HOURS.guide ?? 48),
      })),
      offers: offers.map((row) => ({
        kind: 'offer' as const,
        id: row.id,
        label: row.name,
        detail: `${row.institution.displayName} · ${row.verificationState}`,
        waitingSince: row.createdAt.toISOString(),
        ageHours: ageHours(row.createdAt, now),
        breachingSla: ageHours(row.createdAt, now) > (VERIFICATION_SLA_HOURS.offer ?? 24),
      })),
    };
  }

  /**
   * Institution verification evidence — **and the audit event that records the
   * look.**
   *
   * The write happens before the rows are returned. If the audit write fails,
   * the read fails with it: an unlogged look at somebody's incorporation
   * documents is precisely the thing this endpoint exists to make impossible.
   */
  async evidenceFor(access: AccessContext, institutionId: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, displayName: true },
    });
    if (institution === null) throw AppError.notFound('Institution');

    const evidence = await this.prisma.verificationEvidence.findMany({
      where: { institutionId },
      orderBy: { collectedAt: 'desc' },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'evidence.viewed',
      objectType: 'institution',
      objectId: institutionId,
      metadata: {
        evidenceCount: evidence.length,
        evidenceIds: evidence.map((row) => row.id),
        impersonatedBy: access.impersonatedBy,
      },
    });

    return {
      institution,
      evidence: evidence.map((row) => ({
        id: row.id,
        stage: row.stage,
        summary: row.summary,
        collectedBy: row.collectedBy,
        collectedAt: row.collectedAt.toISOString(),
        /**
         * The object key, never the object. Fetching the document itself is a
         * separate signed-URL call with its own audit event; a console that
         * inlines a passport scan puts it in every screenshot and every
         * browser cache from then on.
         */
        documentRef: row.documentRef,
      })),
    };
  }

  /** Guide verification evidence. Same rule, same audit event. */
  async guideEvidenceFor(access: AccessContext, guideId: string) {
    const guide = await this.prisma.studentGuide.findUnique({
      where: { id: guideId },
      select: { id: true, state: true, stage: true, institutionId: true },
    });
    if (guide === null) throw AppError.notFound('Guide');

    const evidence = await this.prisma.guideVerification.findMany({
      where: { guideId },
      // Explicit columns, because `challengeTokenHash` lives on this table and
      // a `select`-less read would hand the console a credential it has no use
      // for and every opportunity to leak.
      select: {
        id: true,
        evidenceType: true,
        evidenceRef: true,
        summary: true,
        verifiedAt: true,
        expiresAt: true,
        reviewerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'evidence.viewed',
      objectType: 'guide',
      objectId: guideId,
      metadata: {
        evidenceCount: evidence.length,
        evidenceIds: evidence.map((row) => row.id),
        impersonatedBy: access.impersonatedBy,
      },
    });

    return { guide, evidence };
  }

  /**
   * The risk-signal feed (TRD §14).
   *
   * Grouped by signal so a spike in one rule is visible as a spike rather than
   * as a slightly longer list.
   */
  async riskSignals(since: Date, now: Date = new Date()) {
    const flags = await this.prisma.messageFlag.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const bySignal = new Map<string, { signal: string; count: number; critical: number }>();
    for (const flag of flags) {
      const entry = bySignal.get(flag.signal) ?? { signal: flag.signal, count: 0, critical: 0 };
      entry.count += 1;
      if (flag.severity === 'critical') entry.critical += 1;
      bySignal.set(flag.signal, entry);
    }

    return {
      window: { since: since.toISOString(), until: now.toISOString() },
      totals: [...bySignal.values()].sort((a, b) => b.count - a.count),
      recent: flags.slice(0, 50).map((flag) => ({
        id: flag.id,
        signal: flag.signal,
        severity: flag.severity,
        matches: flag.matches,
        trustCaseId: flag.trustCaseId,
        createdAt: flag.createdAt.toISOString(),
        /**
         * The snapshot is evidence and stays in the evidence table. What the
         * feed shows is the matched fragment — enough to triage, not enough to
         * read somebody's conversation over their shoulder.
         */
        excerpt: flag.matches.join(' · ').slice(0, 200),
      })),
    };
  }

  /** Counts for the console's header. Cheap enough to run on every load. */
  async summary(now: Date = new Date()) {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [openCases, criticalCases, pendingInstitutions, pendingGuides, pendingOffers, flagsToday, activeSanctions] =
      await Promise.all([
        this.prisma.trustCase.count({ where: { state: { in: ['open', 'triaging'] } } }),
        this.prisma.trustCase.count({
          where: { state: { in: ['open', 'triaging'] }, severity: 'critical' },
        }),
        this.prisma.institution.count({ where: { verificationState: 'pending' } }),
        this.prisma.studentGuide.count({ where: { state: 'pending' } }),
        this.prisma.offer.count({ where: { publicationState: 'in_review' } }),
        this.prisma.messageFlag.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.sanction.count({ where: { reversedAt: null } }),
      ]);

    return {
      openCases,
      criticalCases,
      queue: { institutions: pendingInstitutions, guides: pendingGuides, offers: pendingOffers },
      flagsLast24h: flagsToday,
      activeSanctions,
    };
  }
}

function ageHours(from: Date, now: Date): number {
  return Math.round(((now.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}
