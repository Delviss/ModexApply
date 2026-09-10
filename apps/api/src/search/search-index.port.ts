import type {
  FacetField,
  ProgramSearchQuery,
  SearchFacet,
  SearchResult,
} from '@modex/contracts';

/**
 * The search index seam.
 *
 * Phase 2 §3 and the TRD name OpenSearch. This port is what makes that a
 * deployment decision rather than a rewrite: the PostgreSQL adapter ships now,
 * so `make dev` stays a fifteen-minute cold start and the p95 budget is
 * measurable in CI without a JVM cluster, and an OpenSearch adapter later has a
 * shared contract-test suite (`test/search-index-contract.ts`) that says
 * exactly what it has to do.
 *
 * The unit of indexing is the **programme key**, not the programme version. A
 * new effective-dated version replaces the row; it does not accumulate one.
 */
export interface SearchDocument {
  programKey: string;
  programId: string;
  version: number;
  name: string;
  description: string | null;
  level: string;
  discipline: string;
  language: string;
  institutionId: string;
  institutionName: string;
  institutionVerified: boolean;
  country: string;
  city: string | null;
  durationMonths: number;
  tuitionMinor: number | null;
  tuitionCurrency: string | null;
  applicationFeeMinor: number | null;
  intakes: string[];
  nextDeadline: Date | null;
  scholarshipAvailable: boolean;
  discountAvailable: boolean;
  sponsored: boolean;
  /**
   * Computed from `publicVisibility(syncState, staleFields)` when the document
   * is built. Stored rather than derived at query time so a query that forgets
   * to filter still cannot surface a programme the freshness sweeper pulled.
   */
  visible: boolean;
  staleFields: string[];
  syncState: string;
  searchText: string;
}

export interface SearchQueryResult {
  results: SearchResult[];
  facets: SearchFacet[];
  totalCount: number;
  nextCursor: string | null;
  /**
   * Populated only when `results` is empty: for each active filter, how many
   * results the same query returns with that one filter dropped. Feeds
   * `diagnoseNoResults`, which turns it into the relaxation suggestions.
   */
  countsWithoutFilter: Partial<Record<FacetField, number>>;
}

export interface SearchIndex {
  /** Replaces the document for this programme key wholesale. */
  upsert(document: SearchDocument): Promise<void>;
  /** Removes a programme key from the index entirely. */
  remove(programKey: string): Promise<void>;
  query(query: ProgramSearchQuery): Promise<SearchQueryResult>;
}

/** DI token, so the adapter is chosen by configuration rather than by import. */
export const SEARCH_INDEX = Symbol('SEARCH_INDEX');
