import { z } from 'zod';
import { PROGRAM_LEVELS } from './catalogue.js';
import { CurrencyCodeSchema } from '../primitives/money.js';

/**
 * Catalogue search and compare (Phase 2 §3, FR-004/FR-006).
 *
 * The query, the facets and the ranking explanation are contracts rather than
 * service internals because the whole promise of the feature is that the
 * ordering is inspectable. A ranked list nobody can interrogate is the agent
 * model in a nicer interface, which is the thing this platform exists to
 * replace.
 */

export const SORT_ORDERS = [
  'relevance',
  'tuition_asc',
  'tuition_desc',
  'deadline_asc',
  'duration_asc',
] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** The facets in Phase 2 §3, one field each. */
export const ProgramSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  country: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
  city: z.array(z.string()).default([]),
  institutionId: z.array(z.string()).default([]),
  level: z.array(z.enum(PROGRAM_LEVELS)).default([]),
  discipline: z.array(z.string()).default([]),
  /** `YYYY-MM`, matching `StudentProfile.targetIntake`. */
  intake: z
    .array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/))
    .default([]),
  tuitionMinMinor: z.number().int().min(0).nullable().default(null),
  tuitionMaxMinor: z.number().int().min(0).nullable().default(null),
  tuitionCurrency: CurrencyCodeSchema.default('GBP'),
  applicationFeeMaxMinor: z.number().int().min(0).nullable().default(null),
  scholarshipAvailable: z.boolean().nullable().default(null),
  discountAvailable: z.boolean().nullable().default(null),
  durationMaxMonths: z.number().int().min(1).nullable().default(null),
  language: z.array(z.string()).default([]),
  sort: z.enum(SORT_ORDERS).default('relevance'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ProgramSearchQuery = z.infer<typeof ProgramSearchQuerySchema>;

/** The facet fields a query can narrow on, in the order the filter rail shows them. */
export const FACET_FIELDS = [
  'country',
  'city',
  'institutionId',
  'level',
  'discipline',
  'intake',
  'tuition',
  'applicationFee',
  'scholarshipAvailable',
  'discountAvailable',
  'duration',
  'language',
] as const;
export type FacetField = (typeof FACET_FIELDS)[number];

export const FACET_LABELS: Readonly<Record<FacetField, string>> = Object.freeze({
  country: 'Country',
  city: 'City',
  institutionId: 'Institution',
  level: 'Level',
  discipline: 'Subject',
  intake: 'Intake',
  tuition: 'Tuition',
  applicationFee: 'Application fee',
  scholarshipAvailable: 'Scholarship available',
  discountAvailable: 'Discount available',
  duration: 'Duration',
  language: 'Language',
});

export const FacetValueSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});

export const SearchFacetSchema = z.object({
  field: z.enum(FACET_FIELDS),
  label: z.string(),
  values: z.array(FacetValueSchema),
});

export type SearchFacet = z.infer<typeof SearchFacetSchema>;

/**
 * One term in the score, with its weight and what it contributed.
 *
 * Every result carries the full set, so "why is this third?" has an answer that
 * does not require reading the ranking source.
 */
export const RankingFactorSchema = z.object({
  factor: z.string(),
  weight: z.number(),
  /** Normalised 0–1 before weighting. */
  rawScore: z.number(),
  contribution: z.number(),
  explanation: z.string(),
});

export type RankingFactor = z.infer<typeof RankingFactorSchema>;

export const SearchResultSchema = z.object({
  programKey: z.string(),
  programId: z.string(),
  name: z.string(),
  level: z.enum(PROGRAM_LEVELS),
  discipline: z.string(),
  institutionId: z.string(),
  institutionName: z.string(),
  institutionVerified: z.boolean(),
  country: z.string(),
  city: z.string().nullable(),
  durationMonths: z.number().int(),
  language: z.string(),
  tuitionMinor: z.number().int().nullable(),
  tuitionCurrency: CurrencyCodeSchema.nullable(),
  applicationFeeMinor: z.number().int().nullable(),
  nextDeadline: z.iso.datetime().nullable(),
  scholarshipAvailable: z.boolean(),
  discountAvailable: z.boolean(),
  /**
   * Set when a commercial relationship affected this row's position. The web
   * layer requires a `<DisclosureNotice>` whenever any result carries it — the
   * flag is on the result rather than the response so a single sponsored row
   * cannot be disclosed away in aggregate.
   */
  sponsored: z.boolean(),
  score: z.number(),
  factors: z.array(RankingFactorSchema),
  staleFields: z.array(z.string()).default([]),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * ---------------------------------------------------------------------------
 * Zero results
 * ---------------------------------------------------------------------------
 *
 * "**No-result handling explains why** and offers the specific filters worth
 * relaxing — never a bare '0 results'" (Phase 2 §3).
 *
 * The diagnosis is computed from per-filter counts: for each active filter, how
 * many results the same query returns with *that one* filter dropped. A filter
 * whose removal recovers results is the one worth suggesting; a filter whose
 * removal changes nothing is not, and suggesting it wastes the student's time.
 */
export const RelaxableFilterSchema = z.object({
  field: z.enum(FACET_FIELDS),
  label: z.string(),
  /** Results this query would return with this one filter dropped. */
  wouldReturn: z.number().int().min(0),
  suggestion: z.string(),
});

export type RelaxableFilter = z.infer<typeof RelaxableFilterSchema>;

export const NoResultDiagnosisSchema = z.object({
  /** The sentence shown above the suggestions. Never "0 results". */
  explanation: z.string(),
  relaxable: z.array(RelaxableFilterSchema),
});

export type NoResultDiagnosis = z.infer<typeof NoResultDiagnosisSchema>;

/** Which facets a query is actually constraining right now. */
export function activeFilters(query: ProgramSearchQuery): FacetField[] {
  const active: FacetField[] = [];
  if (query.country.length > 0) active.push('country');
  if (query.city.length > 0) active.push('city');
  if (query.institutionId.length > 0) active.push('institutionId');
  if (query.level.length > 0) active.push('level');
  if (query.discipline.length > 0) active.push('discipline');
  if (query.intake.length > 0) active.push('intake');
  if (query.tuitionMinMinor !== null || query.tuitionMaxMinor !== null) active.push('tuition');
  if (query.applicationFeeMaxMinor !== null) active.push('applicationFee');
  if (query.scholarshipAvailable !== null) active.push('scholarshipAvailable');
  if (query.discountAvailable !== null) active.push('discountAvailable');
  if (query.durationMaxMonths !== null) active.push('duration');
  if (query.language.length > 0) active.push('language');
  return active;
}

const RELAX_SUGGESTIONS: Readonly<Record<FacetField, string>> = Object.freeze({
  country: 'Include more destinations',
  city: 'Include other cities',
  institutionId: 'Include other institutions',
  level: 'Include another study level',
  discipline: 'Include related subjects',
  intake: 'Include other intakes',
  tuition: 'Widen your tuition range',
  applicationFee: 'Allow a higher application fee',
  scholarshipAvailable: 'Include programmes without a scholarship',
  discountAvailable: 'Include programmes without a discount',
  duration: 'Allow a longer programme',
  language: 'Include other languages of instruction',
});

/**
 * Builds the explanation and the ranked relaxation suggestions.
 *
 * `countsWithoutFilter` maps a facet to the number of results the same query
 * would return with that filter removed. Filters that recover nothing are left
 * out entirely rather than offered as false hope.
 */
export function diagnoseNoResults(
  query: ProgramSearchQuery,
  countsWithoutFilter: Partial<Record<FacetField, number>>,
): NoResultDiagnosis {
  const active = activeFilters(query);

  if (active.length === 0) {
    return {
      explanation:
        query.q === undefined || query.q.length === 0
          ? 'There are no published programmes in the catalogue yet.'
          : `No published programme matches “${query.q}”. Try a broader term — a subject rather than a specific course title.`,
      relaxable: [],
    };
  }

  const relaxable: RelaxableFilter[] = [];
  for (const field of active) {
    const wouldReturn = countsWithoutFilter[field] ?? 0;
    if (wouldReturn > 0) {
      relaxable.push({
        field,
        label: FACET_LABELS[field],
        wouldReturn,
        suggestion: RELAX_SUGGESTIONS[field],
      });
    }
  }
  // Most recovered first: the student's time is better spent on the filter that
  // is actually doing the excluding.
  relaxable.sort((a, b) => b.wouldReturn - a.wouldReturn);

  const filterWord = active.length === 1 ? 'filter' : 'filters';
  const explanation =
    relaxable.length === 0
      ? `Your ${active.length} ${filterWord} rule out every published programme, and so does each one on its own. Clear the filters and start from a broader search.`
      : `Nothing matches all ${active.length} of your ${filterWord} at once. Each one below would bring results back on its own.`;

  return { explanation, relaxable };
}
