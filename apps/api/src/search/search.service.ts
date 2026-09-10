import { Inject, Injectable } from '@nestjs/common';
import {
  diagnoseNoResults,
  decodeCursor,
  encodeCursor,
  StudentProfileSchema,
  type NoResultDiagnosis,
  type ProgramSearchQuery,
  type SearchFacet,
  type SearchResult,
  type StudentProfile,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { PostgresSearchIndex, toSearchResult } from './postgres-search-index.js';
import { rankDocuments, requiresDisclosure, type RankedDocument } from './ranking.js';

export interface SearchResponse {
  results: SearchResult[];
  facets: SearchFacet[];
  totalCount: number;
  nextCursor: string | null;
  /**
   * True when any result on this page was affected by a commercial
   * relationship. The web layer renders `<DisclosureNotice>` whenever it is set
   * — a ranked list with no disclosure is the agent model in a nicer interface.
   */
  requiresDisclosure: boolean;
  /** Present only when there are no results. Never a bare "0 results". */
  noResults: NoResultDiagnosis | null;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PostgresSearchIndex) private readonly index: PostgresSearchIndex,
  ) {}

  /**
   * Runs a catalogue search.
   *
   * `userId` is optional: search works before a profile exists, which is what
   * "progressive onboarding" means in practice. Without one, the profile-shaped
   * ranking factors contribute nothing and say so, rather than being hidden.
   */
  async search(query: ProgramSearchQuery, userId: string | null): Promise<SearchResponse> {
    const profile = userId === null ? null : await this.loadProfileForRanking(userId);

    // One fetch, one ranking. Ranking depends on the profile, which the index
    // does not hold, so the ordering has to happen here -- but fetching the set
    // twice to do it would double the cost of every search on the site.
    const documents = await this.index.fetchDocuments(query);
    const ranked = rankDocuments(documents, query, profile);
    const facets = await this.index.facets(query);

    if (ranked.length === 0) {
      return {
        results: [],
        facets,
        totalCount: 0,
        nextCursor: null,
        requiresDisclosure: false,
        noResults: diagnoseNoResults(query, await this.index.countsWithoutEachFilter(query)),
      };
    }

    const startIndex = cursorIndex(ranked, query.cursor);
    const pageItems = ranked.slice(startIndex, startIndex + query.limit);
    const hasMore = startIndex + query.limit < ranked.length;
    const last = pageItems.at(-1);

    return {
      results: pageItems.map(toSearchResult),
      facets,
      totalCount: ranked.length,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ programKey: last.document.programKey })
          : null,
      requiresDisclosure: requiresDisclosure(pageItems),
      noResults: null,
    };
  }

  /**
   * Only the fields ranking actually reads.
   *
   * Ranking has no business seeing a student's date of birth or their document
   * vault, so it is not handed them.
   */
  private async loadProfileForRanking(userId: string): Promise<StudentProfile | null> {
    const row = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (row === null) return null;

    return StudentProfileSchema.parse({
      id: row.id,
      userId: row.userId,
      dateOfBirth: null,
      nationality: row.nationality,
      countryOfResidence: row.countryOfResidence,
      intendedLevel: row.intendedLevel,
      intendedField: row.intendedField,
      preferredCountries: row.preferredCountries,
      budgetPerYear:
        row.budgetPerYearMinor === null || row.budgetCurrency === null
          ? null
          : { amountMinor: row.budgetPerYearMinor, currency: row.budgetCurrency },
      targetIntake: row.targetIntake,
      academicRecords: [],
      languageTests: [],
      workExperienceMonths: null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}

/**
 * Where the next page starts.
 *
 * The cursor carries the last programme key rather than an offset, because the
 * catalogue shifts under a reader and an offset silently skips or repeats rows
 * when it does. A cursor whose row has since been unpublished restarts from the
 * top rather than erroring: the student clicked "next", and an error is a worse
 * answer than the first page.
 */
function cursorIndex(ranked: readonly RankedDocument[], cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const after = String(decodeCursor(cursor).programKey ?? '');
  const found = ranked.findIndex((entry) => entry.document.programKey === after);
  return found === -1 ? 0 : found + 1;
}
