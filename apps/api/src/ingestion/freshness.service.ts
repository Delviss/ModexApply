import { Injectable, Logger } from '@nestjs/common';
import { FRESHNESS_SLA_HOURS, isStale, severityForField } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { QUEUES, QueueService } from '../queue/queue.service.js';
import { systemActor } from '../auth/audit-actor.js';
import { metrics } from '../common/observability/telemetry.js';

/**
 * Freshness sweeper (Phase 1 section 4).
 *
 * "On SLA breach the record moves to **stale**, not silently wrong."
 *
 * The distinction that matters is the field-severity model: a tuition figure or
 * a deadline that we can no longer vouch for *hides* the record, because showing
 * a student a price that may have changed is worse than showing them nothing. A
 * stale course description only warns, because nobody makes a fifty-thousand-
 * pound decision on a paragraph of marketing copy.
 */
export interface SweepResult {
  programsMarked: number;
  intakesMarked: number;
  feesMarked: number;
  programsHidden: number;
  institutionsAffected: string[];
}

@Injectable()
export class FreshnessService {
  private readonly logger = new Logger(FreshnessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = {
      programsMarked: 0,
      intakesMarked: 0,
      feesMarked: 0,
      programsHidden: 0,
      institutionsAffected: [],
    };
    const affected = new Set<string>();

    const programs = await this.prisma.program.findMany({
      where: { effectiveTo: null, status: { in: ['published', 'in_review'] } },
      select: {
        id: true,
        programKey: true,
        institutionId: true,
        sourceUpdatedAt: true,
        expiresAt: true,
        syncState: true,
        staleFields: true,
        status: true,
      },
    });

    for (const program of programs) {
      const stale = isStale(
        {
          sourceUpdatedAt: program.sourceUpdatedAt?.toISOString() ?? null,
          expiresAt: program.expiresAt?.toISOString() ?? null,
        },
        'program',
        now,
      );

      // Fees and intakes have their own, shorter SLAs, and their staleness
      // attaches to the programme because that is where a student reads them.
      const fees = await this.prisma.programFees.findFirst({
        where: { programId: program.id },
        orderBy: { sourceUpdatedAt: 'desc' },
      });
      const feesStale =
        fees !== null &&
        isStale(
          {
            sourceUpdatedAt: fees.sourceUpdatedAt?.toISOString() ?? null,
            expiresAt: fees.expiresAt?.toISOString() ?? null,
          },
          'fee',
          now,
        );

      const intakes = await this.prisma.intake.findMany({ where: { programKey: program.programKey } });
      const intakesStale = intakes.some((intake) =>
        isStale(
          {
            sourceUpdatedAt: intake.sourceUpdatedAt?.toISOString() ?? null,
            expiresAt: intake.expiresAt?.toISOString() ?? null,
          },
          'intake',
          now,
        ),
      );

      const staleFields = [
        ...(stale ? ['description', 'duration'] : []),
        ...(feesStale ? ['tuitionFee'] : []),
        ...(intakesStale ? ['applicationDeadline'] : []),
      ];

      if (staleFields.length === 0) continue;

      const hasBlocking = staleFields.some((field) => severityForField(field) === 'blocking');

      await this.prisma.program.update({
        where: { id: program.id },
        data: {
          syncState: 'stale',
          staleFields,
          // A blocking-field lapse pulls the record off the public site. It is
          // not archived and not deleted: the moment the university confirms the
          // figure, it publishes again.
          ...(hasBlocking && program.status === 'published' ? { status: 'in_review' as const } : {}),
        },
      });

      // The sweep is one of two places a programme's visibility changes with no
      // user request behind it. Missing it here is how a programme pulled for a
      // stale price stays in search results still carrying that price.
      await this.queue.enqueue(QUEUES.searchIndex, 'reindex', { programKey: program.programKey });

      result.programsMarked += 1;
      if (feesStale) result.feesMarked += 1;
      if (intakesStale) result.intakesMarked += 1;
      if (hasBlocking) result.programsHidden += 1;
      affected.add(program.institutionId);

      await this.audit.record({
        actor: systemActor(),
        action: 'catalogue.marked_stale',
        objectType: 'program',
        objectId: program.id,
        metadata: {
          programKey: program.programKey,
          staleFields,
          hidden: hasBlocking,
          slaHours: FRESHNESS_SLA_HOURS.program,
        },
      });
    }

    result.institutionsAffected = [...affected];
    for (const institutionId of affected) {
      metrics.catalogueRecordsMarkedStale(institutionId, result.programsMarked);
    }

    if (result.programsHidden > 0) {
      // Ops needs to know, because the fix is a conversation with the partner,
      // not a code change.
      this.logger.warn(
        `Freshness sweep hid ${result.programsHidden} programme(s) across ` +
          `${affected.size} institution(s) after an SLA breach`,
      );
    }

    return result;
  }

  /** Clears staleness for a record the university has just re-confirmed. */
  async markConfirmed(programId: string, sourceUpdatedAt: Date, reviewedBy: string | null) {
    const program = await this.prisma.program.update({
      where: { id: programId },
      data: {
        sourceUpdatedAt,
        syncState: 'synced',
        staleFields: [],
        verifiedAt: new Date(),
        reviewedBy,
      },
    });

    // The other half: confirmation puts a programme back on the public site,
    // and search has to learn about that too.
    await this.queue.enqueue(QUEUES.searchIndex, 'reindex', { programKey: program.programKey });
    return program;
  }
}
