import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PostgresSearchIndex } from './postgres-search-index.js';
import { buildSearchDocument } from './search-document.js';

/**
 * Keeps the search index in step with the catalogue.
 *
 * Called from every place a programme's public visibility can change: the
 * catalogue writes, the bulk import commit, and — the two that happen with no
 * user request behind them — the freshness sweep and its confirmation. Missing
 * either of those last two is how a programme the sweeper pulled stays in
 * search results with a stale price on it.
 *
 * Reindexing is idempotent and keyed on `programKey`, so replaying a job is
 * always safe.
 */
@Injectable()
export class IndexerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly index: PostgresSearchIndex,
  ) {}

  /** Rebuilds one programme's document from the authoritative tables. */
  async reindexProgram(programKey: string, now: Date = new Date()): Promise<void> {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: {
        institution: {
          select: {
            displayName: true,
            country: true,
            verificationState: true,
            verificationStage: true,
          },
        },
        campus: { select: { city: true } },
        fees: { orderBy: { sourceUpdatedAt: 'desc' }, take: 1 },
      },
    });

    // No current version means the programme was archived or never existed.
    // Removing rather than leaving a stale row is the whole point of running
    // this on unpublish.
    if (program === null) {
      await this.index.remove(programKey);
      return;
    }

    const intakes = await this.prisma.intake.findMany({ where: { programKey } });
    const [fees] = program.fees;

    const document = buildSearchDocument(
      {
        program: {
          id: program.id,
          programKey: program.programKey,
          name: program.name,
          level: program.level,
          field: program.field,
          description: program.description,
          durationMonths: program.durationMonths,
          version: program.version,
          status: program.status,
          syncState: program.syncState,
          staleFields: program.staleFields,
          institutionId: program.institutionId,
        },
        institution: program.institution,
        campus: program.campus,
        fees:
          fees === undefined
            ? null
            : {
                tuitionMinor: fees.tuitionMinor,
                tuitionCurrency: fees.tuitionCurrency,
                applicationFeeMinor: fees.applicationFeeMinor,
              },
        intakes,
      },
      now,
    );

    // An invisible programme is removed from the index rather than stored with
    // `visible: false`. Two guards are better than one: a query bug cannot
    // surface a row that is not there.
    if (!document.visible) {
      await this.index.remove(programKey);
      return;
    }

    await this.index.upsert(document);
  }

  /** Rebuilds every current programme. Used by the seed and the latency test. */
  async reindexAll(now: Date = new Date()): Promise<number> {
    const programs = await this.prisma.program.findMany({
      where: { effectiveTo: null },
      select: { programKey: true },
      distinct: ['programKey'],
    });
    for (const program of programs) {
      await this.reindexProgram(program.programKey, now);
    }
    return programs.length;
  }
}
