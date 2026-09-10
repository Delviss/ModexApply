import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  activeFilters,
  encodeCursor,
  decodeCursor,
  FACET_LABELS,
  type FacetField,
  type ProgramSearchQuery,
  type SearchFacet,
  type SearchResult,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  SearchDocument,
  SearchIndex,
  SearchQueryResult,
} from './search-index.port.js';
import { rankDocuments, type RankedDocument } from './ranking.js';

/**
 * PostgreSQL adapter for the `SearchIndex` port.
 *
 * Free text goes through trigram similarity rather than `tsvector` alone,
 * because students mistype programme names and a whole-word index matches
 * "data sciene" against nothing. The migration installs both indexes; this
 * adapter uses trigram for matching and keeps the full-text index for the
 * relevance ordering Postgres can do cheaply.
 *
 * Ranking itself is *not* delegated to Postgres. It happens in `ranking.ts`,
 * against the profile, so that the factors returned to the student are the
 * factors that actually produced the order — an ORDER BY expression cannot
 * explain itself.
 */
@Injectable()
export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(document: SearchDocument): Promise<void> {
    const data = {
      programId: document.programId,
      version: document.version,
      name: document.name,
      description: document.description,
      level: document.level as never,
      discipline: document.discipline,
      language: document.language,
      institutionId: document.institutionId,
      institutionName: document.institutionName,
      institutionVerified: document.institutionVerified,
      country: document.country,
      city: document.city,
      durationMonths: document.durationMonths,
      tuitionMinor: document.tuitionMinor,
      tuitionCurrency: document.tuitionCurrency,
      applicationFeeMinor: document.applicationFeeMinor,
      intakes: document.intakes,
      nextDeadline: document.nextDeadline,
      scholarshipAvailable: document.scholarshipAvailable,
      discountAvailable: document.discountAvailable,
      sponsored: document.sponsored,
      visible: document.visible,
      staleFields: document.staleFields,
      syncState: document.syncState as never,
      searchText: document.searchText,
      indexedAt: new Date(),
    };

    // Replaced wholesale rather than patched field by field: a partial update
    // is how an index drifts from its source.
    await this.prisma.programSearchDocument.upsert({
      where: { programKey: document.programKey },
      create: { programKey: document.programKey, ...data },
      update: data,
    });
  }

  async remove(programKey: string): Promise<void> {
    await this.prisma.programSearchDocument.deleteMany({ where: { programKey } });
  }

  async query(query: ProgramSearchQuery): Promise<SearchQueryResult> {
    const rows = await this.fetch(query);
    const ranked = rankDocuments(rows, query, null);

    const { pageItems, nextCursor } = this.paginate(ranked, query);
    const facets = await this.facets(query);

    // Only computed when there is nothing to show. Running one extra query per
    // active filter on every successful search would be paying for the empty
    // case on every non-empty one.
    const countsWithoutFilter =
      ranked.length === 0 ? await this.countsWithoutEachFilter(query) : {};

    return {
      results: pageItems.map(toSearchResult),
      facets,
      totalCount: ranked.length,
      nextCursor,
      countsWithoutFilter,
    };
  }

  /**
   * Ranking depends on the student's profile, which the index does not hold, so
   * the service re-ranks with a profile after fetching. Exposed for that.
   */
  async fetchDocuments(query: ProgramSearchQuery): Promise<SearchDocument[]> {
    return this.fetch(query);
  }

  private async fetch(query: ProgramSearchQuery): Promise<SearchDocument[]> {
    const rows = await this.prisma.programSearchDocument.findMany({
      where: this.whereFor(query),
    });
    return rows.map(fromRow);
  }

  /** The facet clause set, minus one field — the basis of both facet counts and relaxation counts. */
  private whereFor(
    query: ProgramSearchQuery,
    except?: FacetField,
  ): Prisma.ProgramSearchDocumentWhereInput {
    const where: Prisma.ProgramSearchDocumentWhereInput = { visible: true };
    const and: Prisma.ProgramSearchDocumentWhereInput[] = [];

    if (query.q !== undefined && query.q.trim().length > 0) {
      const term = query.q.trim();
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { discipline: { contains: term, mode: 'insensitive' } },
          { searchText: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (except !== 'country' && query.country.length > 0) and.push({ country: { in: query.country } });
    if (except !== 'city' && query.city.length > 0) and.push({ city: { in: query.city } });
    if (except !== 'institutionId' && query.institutionId.length > 0) {
      and.push({ institutionId: { in: query.institutionId } });
    }
    if (except !== 'level' && query.level.length > 0) {
      and.push({ level: { in: query.level as never[] } });
    }
    if (except !== 'discipline' && query.discipline.length > 0) {
      and.push({ discipline: { in: query.discipline } });
    }
    if (except !== 'intake' && query.intake.length > 0) {
      and.push({ intakes: { hasSome: query.intake } });
    }
    if (except !== 'language' && query.language.length > 0) {
      and.push({ language: { in: query.language } });
    }

    if (except !== 'tuition' && (query.tuitionMinMinor !== null || query.tuitionMaxMinor !== null)) {
      // A programme with no published fee is excluded from a price filter
      // rather than treated as free — the freshness model's "a wrong price is
      // worse than an absent one", applied to search.
      and.push({
        tuitionMinor: {
          not: null,
          ...(query.tuitionMinMinor !== null ? { gte: query.tuitionMinMinor } : {}),
          ...(query.tuitionMaxMinor !== null ? { lte: query.tuitionMaxMinor } : {}),
        },
        tuitionCurrency: query.tuitionCurrency,
      });
    }

    if (except !== 'applicationFee' && query.applicationFeeMaxMinor !== null) {
      and.push({ applicationFeeMinor: { lte: query.applicationFeeMaxMinor } });
    }
    if (except !== 'scholarshipAvailable' && query.scholarshipAvailable !== null) {
      and.push({ scholarshipAvailable: query.scholarshipAvailable });
    }
    if (except !== 'discountAvailable' && query.discountAvailable !== null) {
      and.push({ discountAvailable: query.discountAvailable });
    }
    if (except !== 'duration' && query.durationMaxMonths !== null) {
      and.push({ durationMonths: { lte: query.durationMaxMonths } });
    }

    if (and.length > 0) where.AND = and;
    return where;
  }

  /**
   * Keyset paging over the ranked list.
   *
   * The cursor carries the programme key of the last row shown rather than an
   * offset, because the catalogue shifts under a reader and an offset silently
   * skips or repeats rows when it does.
   */
  private paginate(
    ranked: readonly RankedDocument[],
    query: ProgramSearchQuery,
  ): { pageItems: RankedDocument[]; nextCursor: string | null } {
    let startIndex = 0;
    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);
      const after = String(decoded.programKey ?? '');
      const found = ranked.findIndex((entry) => entry.document.programKey === after);
      // A cursor whose row has since been unpublished restarts the page rather
      // than erroring: the student clicked "next", and an error is a worse
      // answer than the next page.
      startIndex = found === -1 ? 0 : found + 1;
    }

    const pageItems = ranked.slice(startIndex, startIndex + query.limit);
    const hasMore = startIndex + query.limit < ranked.length;
    const last = pageItems.at(-1);

    return {
      pageItems,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ programKey: last.document.programKey })
          : null,
    };
  }

  /** Facet counts, each computed with its own field excluded so the options do not collapse to one. */
  async facets(query: ProgramSearchQuery): Promise<SearchFacet[]> {
    const facets: SearchFacet[] = [];

    for (const [field, column] of [
      ['country', 'country'],
      ['level', 'level'],
      ['discipline', 'discipline'],
      ['institutionId', 'institutionId'],
      ['language', 'language'],
    ] as const) {
      // Excluding the facet's own filter is what keeps the other options
      // visible and clickable. Counting with it applied would show only the
      // value already chosen, which is a filter rail that cannot be changed.
      const grouped = await this.prisma.programSearchDocument.groupBy({
        by: [column],
        where: this.whereFor(query, field as FacetField),
        _count: { _all: true },
      });

      const values = grouped
        .map((entry) => ({
          value: String((entry as Record<string, unknown>)[column] ?? ''),
          label:
            field === 'institutionId'
              ? String((entry as Record<string, unknown>)[column] ?? '')
              : String((entry as Record<string, unknown>)[column] ?? ''),
          count: entry._count._all,
        }))
        .filter((entry) => entry.value.length > 0)
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

      if (values.length > 0) {
        facets.push({ field: field as FacetField, label: FACET_LABELS[field as FacetField], values });
      }
    }

    // Institution ids are opaque; the rail needs names.
    const institutionFacet = facets.find((facet) => facet.field === 'institutionId');
    if (institutionFacet !== undefined) {
      const names = await this.prisma.programSearchDocument.findMany({
        where: { institutionId: { in: institutionFacet.values.map((value) => value.value) } },
        select: { institutionId: true, institutionName: true },
        distinct: ['institutionId'],
      });
      const byId = new Map(names.map((row) => [row.institutionId, row.institutionName]));
      institutionFacet.values = institutionFacet.values.map((value) => ({
        ...value,
        label: byId.get(value.value) ?? value.value,
      }));
    }

    return facets;
  }

  /**
   * For each active filter, how many results the query returns without it.
   *
   * This is what turns "0 results" into "your level filter is the one doing the
   * excluding — drop it and 31 programmes come back".
   */
  async countsWithoutEachFilter(
    query: ProgramSearchQuery,
  ): Promise<Partial<Record<FacetField, number>>> {
    const counts: Partial<Record<FacetField, number>> = {};
    for (const field of activeFilters(query)) {
      counts[field] = await this.prisma.programSearchDocument.count({
        where: this.whereFor(query, field),
      });
    }
    return counts;
  }
}

type Row = Awaited<ReturnType<PrismaService['programSearchDocument']['findMany']>>[number];

export function fromRow(row: Row): SearchDocument {
  return {
    programKey: row.programKey,
    programId: row.programId,
    version: row.version,
    name: row.name,
    description: row.description,
    level: row.level,
    discipline: row.discipline,
    language: row.language,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    institutionVerified: row.institutionVerified,
    country: row.country,
    city: row.city,
    durationMonths: row.durationMonths,
    tuitionMinor: row.tuitionMinor,
    tuitionCurrency: row.tuitionCurrency,
    applicationFeeMinor: row.applicationFeeMinor,
    intakes: row.intakes,
    nextDeadline: row.nextDeadline,
    scholarshipAvailable: row.scholarshipAvailable,
    discountAvailable: row.discountAvailable,
    sponsored: row.sponsored,
    visible: row.visible,
    staleFields: row.staleFields,
    syncState: row.syncState,
    searchText: row.searchText,
  };
}

export function toSearchResult(ranked: RankedDocument): SearchResult {
  const { document } = ranked;
  return {
    programKey: document.programKey,
    programId: document.programId,
    name: document.name,
    level: document.level as SearchResult['level'],
    discipline: document.discipline,
    institutionId: document.institutionId,
    institutionName: document.institutionName,
    institutionVerified: document.institutionVerified,
    country: document.country,
    city: document.city,
    durationMonths: document.durationMonths,
    language: document.language,
    tuitionMinor: document.tuitionMinor,
    tuitionCurrency: document.tuitionCurrency,
    applicationFeeMinor: document.applicationFeeMinor,
    nextDeadline: document.nextDeadline === null ? null : document.nextDeadline.toISOString(),
    scholarshipAvailable: document.scholarshipAvailable,
    discountAvailable: document.discountAvailable,
    sponsored: document.sponsored,
    score: ranked.score,
    factors: ranked.factors,
    staleFields: document.staleFields,
  };
}
