import { ProgramSearchQuerySchema, type ProgramSearchQuery } from '@modex/contracts';

/**
 * The search query lives in the URL.
 *
 * Nothing in Phases 0–1 did this — the admin table kept its filters in
 * component state, so a filtered view could not be shared, bookmarked, or
 * reached with the back button. For a catalogue search that is the difference
 * between a link a student can send their family and a screenshot.
 *
 * The parse is deliberately forgiving: a malformed parameter falls back to the
 * default rather than erroring, because the input here is a URL somebody may
 * have edited by hand or truncated in a message.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const parts = Array.isArray(value) ? value : value.split(',');
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function num(value: string | string[] | undefined): number | null {
  if (value === undefined || Array.isArray(value) || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: string | string[] | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function parseSearchParams(raw: RawSearchParams): ProgramSearchQuery {
  const parsed = ProgramSearchQuerySchema.safeParse({
    q: typeof raw.q === 'string' && raw.q.length > 0 ? raw.q : undefined,
    country: list(raw.country),
    city: list(raw.city),
    institutionId: list(raw.institutionId),
    level: list(raw.level),
    discipline: list(raw.discipline),
    intake: list(raw.intake),
    language: list(raw.language),
    tuitionMinMinor: num(raw.tuitionMinMinor),
    tuitionMaxMinor: num(raw.tuitionMaxMinor),
    applicationFeeMaxMinor: num(raw.applicationFeeMaxMinor),
    durationMaxMonths: num(raw.durationMaxMonths),
    scholarshipAvailable: bool(raw.scholarshipAvailable),
    discountAvailable: bool(raw.discountAvailable),
    sort: typeof raw.sort === 'string' ? raw.sort : undefined,
    cursor: typeof raw.cursor === 'string' ? raw.cursor : undefined,
  });

  // A hand-edited URL should not be an error page. An unparseable query means
  // an unfiltered search, which is a page the student can work from.
  return parsed.success ? parsed.data : ProgramSearchQuerySchema.parse({});
}

/** Serialises a query back to a query string, omitting everything at its default. */
export function toSearchString(query: ProgramSearchQuery): string {
  const params = new URLSearchParams();

  if (query.q !== undefined && query.q.length > 0) params.set('q', query.q);
  for (const field of ['country', 'city', 'institutionId', 'level', 'discipline', 'intake', 'language'] as const) {
    const values = query[field];
    if (values.length > 0) params.set(field, values.join(','));
  }
  for (const field of ['tuitionMinMinor', 'tuitionMaxMinor', 'applicationFeeMaxMinor', 'durationMaxMonths'] as const) {
    const value = query[field];
    if (value !== null) params.set(field, String(value));
  }
  for (const field of ['scholarshipAvailable', 'discountAvailable'] as const) {
    const value = query[field];
    if (value !== null) params.set(field, String(value));
  }
  if (query.sort !== 'relevance') params.set('sort', query.sort);

  const serialised = params.toString();
  return serialised.length === 0 ? '' : `?${serialised}`;
}

/** Drops one facet from a query — what the zero-result suggestions do. */
export function withoutFacet(query: ProgramSearchQuery, field: string): ProgramSearchQuery {
  const next: ProgramSearchQuery = { ...query, cursor: undefined };
  switch (field) {
    case 'tuition':
      return { ...next, tuitionMinMinor: null, tuitionMaxMinor: null };
    case 'applicationFee':
      return { ...next, applicationFeeMaxMinor: null };
    case 'duration':
      return { ...next, durationMaxMonths: null };
    case 'scholarshipAvailable':
      return { ...next, scholarshipAvailable: null };
    case 'discountAvailable':
      return { ...next, discountAvailable: null };
    case 'country':
    case 'city':
    case 'institutionId':
    case 'level':
    case 'discipline':
    case 'intake':
    case 'language':
      return { ...next, [field]: [] };
    default:
      return next;
  }
}

export type MultiFacet =
  | 'country'
  | 'city'
  | 'institutionId'
  | 'level'
  | 'discipline'
  | 'intake'
  | 'language';

/**
 * Toggles one value in a multi-select facet.
 *
 * The result goes back through the schema rather than being cast into place.
 * `level` is a closed enum, and a value arriving from a facet response the
 * server built is *probably* valid — but "probably" is how an unparseable
 * level ends up in a URL that then renders an empty page with no explanation.
 * Re-parsing means a bad value is dropped here, where the fallback is obvious.
 */
export function toggleFacetValue(
  query: ProgramSearchQuery,
  field: MultiFacet,
  value: string,
): ProgramSearchQuery {
  const current: readonly string[] = query[field];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];

  const candidate = ProgramSearchQuerySchema.safeParse({
    ...query,
    [field]: next,
    // Paging is relative to a result set that just changed, so the cursor goes.
    cursor: undefined,
  });
  return candidate.success ? candidate.data : { ...query, cursor: undefined };
}
