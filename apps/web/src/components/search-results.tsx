'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  RangeField,
  Sheet,
  formatDate,
} from '@modex/ui';
import {
  formatMoney,
  money,
  type NoResultDiagnosis,
  type ProgramSearchQuery,
  type SearchFacet,
  type SearchResult,
} from '@modex/contracts';
import { LEVEL_LABELS } from '@/lib/labels';
import {
  toSearchString,
  toggleFacetValue,
  withoutFacet,
  type MultiFacet,
} from '@/lib/search-params';

export interface SearchResultsProps {
  query: ProgramSearchQuery;
  results: SearchResult[];
  facets: SearchFacet[];
  totalCount: number;
  noResults: NoResultDiagnosis | null;
}

/**
 * Search results with a persistent filter rail.
 *
 * Every filter change is a navigation, not a state update: the query lives in
 * the URL so a search can be shared, bookmarked and reached with the back
 * button. That also means the server does the filtering, which is the only
 * place it can be done correctly — the client never has the whole set.
 */
export function SearchResults({
  query,
  results,
  facets,
  totalCount,
  noResults,
}: SearchResultsProps) {
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);

  function apply(next: ProgramSearchQuery): void {
    router.push(`/programmes${toSearchString(next)}`);
  }

  const rail = <FilterRail query={query} facets={facets} onChange={apply} />;

  return (
    <div className="mx-search">
      <aside className="mx-search__rail" aria-label="Filters">
        {rail}
      </aside>

      <div className="mx-search__main">
        <div className="mx-search__toolbar">
          {/*
            The count is a live region: a screen-reader user changing a filter
            has no other signal that the page under them changed.
          */}
          <p className="mx-search__count" aria-live="polite" role="status">
            {totalCount === 0
              ? 'No programmes match your filters'
              : `${totalCount} programme${totalCount === 1 ? '' : 's'} match your filters`}
          </p>

          <div className="mx-search__controls">
            <Button
              variant="secondary"
              size="sm"
              className="mx-search__filter-toggle"
              onClick={() => setFiltersOpen(true)}
            >
              Filters
            </Button>
            <SortControl query={query} onChange={apply} />
          </div>
        </div>

        {noResults === null ? (
          <ol className="mx-search__results">
            {results.map((result) => (
              <li key={result.programKey}>
                <ResultCard result={result} />
              </li>
            ))}
          </ol>
        ) : (
          <NoResults diagnosis={noResults} query={query} onChange={apply} />
        )}
      </div>

      {/* The same rail, in a sheet, on a phone. */}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        variant="side"
        footer={
          <Button onClick={() => setFiltersOpen(false)}>
            Show {totalCount} result{totalCount === 1 ? '' : 's'}
          </Button>
        }
      >
        {rail}
      </Sheet>
    </div>
  );
}

function SortControl({
  query,
  onChange,
}: {
  query: ProgramSearchQuery;
  onChange: (next: ProgramSearchQuery) => void;
}) {
  return (
    <label className="mx-search__sort">
      <span className="mx-visually-hidden">Sort results by</span>
      <select
        className="mx-select"
        value={query.sort}
        onChange={(event) =>
          onChange({
            ...query,
            sort: event.target.value as ProgramSearchQuery['sort'],
            cursor: undefined,
          })
        }
      >
        <option value="relevance">Best match</option>
        <option value="tuition_asc">Lowest tuition</option>
        <option value="tuition_desc">Highest tuition</option>
        <option value="deadline_asc">Deadline soonest</option>
        <option value="duration_asc">Shortest</option>
      </select>
    </label>
  );
}

function FilterRail({
  query,
  facets,
  onChange,
}: {
  query: ProgramSearchQuery;
  facets: SearchFacet[];
  onChange: (next: ProgramSearchQuery) => void;
}) {
  const multiSelect: readonly MultiFacet[] = [
    'country',
    'level',
    'discipline',
    'institutionId',
    'language',
  ];

  return (
    <div className="mx-filter-rail">
      {facets
        .filter((facet) => multiSelect.includes(facet.field as MultiFacet))
        .map((facet) => (
          <fieldset className="mx-filter-group" key={facet.field}>
            <legend className="mx-filter-group__legend">{facet.label}</legend>
            {facet.values.slice(0, 8).map((value) => (
              <Checkbox
                key={value.value}
                label={
                  facet.field === 'level' ? (LEVEL_LABELS[value.value] ?? value.label) : value.label
                }
                meta={value.count}
                checked={(query[facet.field as MultiFacet] as readonly string[]).includes(
                  value.value,
                )}
                onChange={() =>
                  onChange(toggleFacetValue(query, facet.field as MultiFacet, value.value))
                }
              />
            ))}
          </fieldset>
        ))}

      <fieldset className="mx-filter-group">
        <legend className="mx-filter-group__legend">Tuition</legend>
        <RangeField
          label="Maximum tuition per year"
          min={0}
          max={6_000_000}
          step={100_000}
          value={query.tuitionMaxMinor ?? 6_000_000}
          onChange={(value) =>
            onChange({
              ...query,
              tuitionMaxMinor: value >= 6_000_000 ? null : value,
              cursor: undefined,
            })
          }
          format={(value) =>
            value >= 6_000_000
              ? 'Any tuition'
              : `Up to ${formatMoney(money(value, query.tuitionCurrency))}`
          }
        />
      </fieldset>

      <fieldset className="mx-filter-group">
        <legend className="mx-filter-group__legend">Funding</legend>
        <Checkbox
          label="Scholarship available"
          checked={query.scholarshipAvailable === true}
          onChange={(event) =>
            onChange({
              ...query,
              scholarshipAvailable: event.target.checked ? true : null,
              cursor: undefined,
            })
          }
        />
        <Checkbox
          label="Discount available"
          checked={query.discountAvailable === true}
          onChange={(event) =>
            onChange({
              ...query,
              discountAvailable: event.target.checked ? true : null,
              cursor: undefined,
            })
          }
        />
      </fieldset>
    </div>
  );
}

/**
 * The zero-result rule, rendered.
 *
 * `EmptyState` requires a description, which is half the guarantee; the other
 * half is that each suggestion is a real control that actually relaxes the
 * filter it names, with the number of results it would bring back.
 */
function NoResults({
  diagnosis,
  query,
  onChange,
}: {
  diagnosis: NoResultDiagnosis;
  query: ProgramSearchQuery;
  onChange: (next: ProgramSearchQuery) => void;
}) {
  return (
    <EmptyState title="No programmes match all your filters" description={diagnosis.explanation}>
      {diagnosis.relaxable.length === 0 ? (
        <Button variant="secondary" onClick={() => onChange({ ...query, cursor: undefined })}>
          Clear all filters
        </Button>
      ) : (
        <ul className="mx-search__suggestions">
          {diagnosis.relaxable.map((filter) => (
            <li key={filter.field}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onChange(withoutFacet(query, filter.field))}
              >
                {filter.suggestion}
              </Button>{' '}
              <span className="mx-card__description">
                {filter.wouldReturn} programme{filter.wouldReturn === 1 ? '' : 's'} would come back
              </span>
            </li>
          ))}
        </ul>
      )}
    </EmptyState>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <Card padding="lg">
      <div className="mx-result-card">
        <div>
          <h3 className="mx-card__title">
            <Link href={`/programmes/${result.programKey}`}>{result.name}</Link>
          </h3>
          <p className="mx-card__description">
            {result.institutionName}
            {result.city === null ? '' : ` · ${result.city}`} · {result.country}
          </p>
        </div>

        <div className="mx-result-card__meta">
          <span>{LEVEL_LABELS[result.level] ?? result.level}</span>
          <span>{result.durationMonths} months</span>
          <span>
            {result.tuitionMinor === null || result.tuitionCurrency === null
              ? 'Tuition not published'
              : formatMoney(money(result.tuitionMinor, result.tuitionCurrency))}
          </span>
          <span>
            {result.nextDeadline === null
              ? 'No published deadline'
              : `Apply by ${formatDate(result.nextDeadline)}`}
          </span>
        </div>

        <div className="mx-result-card__meta">
          {result.institutionVerified ? (
            <Badge tone="success">Verified institution</Badge>
          ) : (
            <Badge tone="neutral">Verification in progress</Badge>
          )}
          {result.scholarshipAvailable ? <Badge tone="info">Scholarship</Badge> : null}
          {result.staleFields.length > 0 ? (
            <Badge tone="warning">Confirming {result.staleFields.join(', ')}</Badge>
          ) : null}
          {/*
            Sponsorship is disclosed on the row it affected, not only in an
            aggregate notice at the top of the page.
          */}
          {result.sponsored ? <Badge tone="neutral">Paid placement</Badge> : null}
        </div>
      </div>
    </Card>
  );
}
