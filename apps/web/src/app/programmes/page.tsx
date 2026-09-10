import type { Metadata } from 'next';
import { Card, CardHeader, DisclosureNotice, Alert } from '@modex/ui';
import type { NoResultDiagnosis, SearchFacet, SearchResult } from '@modex/contracts';
import { ApiError, MONEY_REVALIDATE_SECONDS, apiGet } from '@/lib/api';
import { parseSearchParams, toSearchString, type RawSearchParams } from '@/lib/search-params';
import { SearchResults } from '@/components/search-results';

export const metadata: Metadata = {
  title: 'Search programmes',
  description:
    'Search verified university programmes by country, subject, level, intake and tuition. Every result shows what it costs and when it closes.',
};

interface SearchResponse {
  results: SearchResult[];
  facets: SearchFacet[];
  totalCount: number;
  nextCursor: string | null;
  requiresDisclosure: boolean;
  noResults: NoResultDiagnosis | null;
}

/**
 * Catalogue search (Phase 2 §3).
 *
 * Server-rendered like the rest of the public catalogue, so results are
 * crawlable and the first paint carries real content rather than a spinner.
 * `MONEY_REVALIDATE_SECONDS` because every card shows a tuition fee, and the
 * whole freshness model exists to stop a wrong price being served.
 */
export default async function ProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const query = parseSearchParams(raw);

  let response: SearchResponse | null = null;
  let failed = false;
  try {
    response = await apiGet<SearchResponse>(`/programmes${toSearchString(query)}`, {
      revalidate: MONEY_REVALIDATE_SECONDS,
    });
  } catch (error) {
    // A search that cannot reach the API is a broken search, not an empty one.
    // Rendering "no programmes match" here would be a lie with consequences.
    if (!(error instanceof ApiError)) throw error;
    failed = true;
  }

  return (
    <main className="mx-search-page">
      <header className="mx-search-page__header">
        <h1 className="mx-card__title">Find a programme</h1>
        <p className="mx-card__description">
          Every programme here comes from a university Modex has verified. Fees and
          deadlines show when they were last confirmed.
        </p>
      </header>

      {failed || response === null ? (
        <Card padding="lg">
          <Alert tone="danger" title="We could not run that search">
            Something went wrong on our side — this is not a result about the
            programmes you were looking for. Try again in a moment.
          </Alert>
        </Card>
      ) : (
        <>
          {/*
            Required on any surface that orders or recommends. Rendered whenever
            a commercial relationship touched this page's ordering, and kept as
            a landmark rather than a dismissible toast.
          */}
          {response.requiresDisclosure ? <DisclosureNotice kind="ranking_method" /> : null}

          <SearchResults
            query={query}
            results={response.results}
            facets={response.facets}
            totalCount={response.totalCount}
            noResults={response.noResults}
          />

          {response.requiresDisclosure ? null : (
            <Card padding="md">
              <CardHeader
                title="How this list is ordered"
                description="Results are ordered by how well each programme matches the requirements you can see, and nothing on this page was paid for. Open any programme to see the factors that placed it."
              />
            </Card>
          )}
        </>
      )}
    </main>
  );
}
