import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProgramSearchQuerySchema, type SearchResult } from '@modex/contracts';
import { SearchResults } from '@/components/search-results';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    programKey: 'msc-data-science',
    programId: 'p_1',
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    discipline: 'Computing',
    institutionId: 'inst_1',
    institutionName: 'University of Example',
    institutionVerified: true,
    country: 'GB',
    city: 'Manchester',
    durationMonths: 12,
    language: 'English',
    tuitionMinor: 2_400_000,
    tuitionCurrency: 'GBP',
    applicationFeeMinor: 5_000,
    nextDeadline: '2027-07-01T00:00:00.000Z',
    scholarshipAvailable: false,
    discountAvailable: false,
    sponsored: false,
    score: 0.8,
    factors: [],
    staleFields: [],
    ...overrides,
  };
}

const query = ProgramSearchQuerySchema.parse({});

describe('<SearchResults>', () => {
  it('announces the result count in a live region', () => {
    render(
      <SearchResults query={query} results={[result()]} facets={[]} totalCount={1} noResults={null} />,
    );
    const count = screen.getByText('1 programme match your filters');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(count).toHaveAttribute('role', 'status');
  });

  it('shows the fee and the deadline on every card', () => {
    render(
      <SearchResults query={query} results={[result()]} facets={[]} totalCount={1} noResults={null} />,
    );
    expect(screen.getByText(/£24,000/)).toBeInTheDocument();
    expect(screen.getByText(/apply by/i)).toBeInTheDocument();
  });

  // A missing figure is stated, never filled in with a guess or a zero.
  it('says when a fee or deadline is not published', () => {
    render(
      <SearchResults
        query={query}
        results={[result({ tuitionMinor: null, tuitionCurrency: null, nextDeadline: null })]}
        facets={[]}
        totalCount={1}
        noResults={null}
      />,
    );
    expect(screen.getByText('Tuition not published')).toBeInTheDocument();
    expect(screen.getByText('No published deadline')).toBeInTheDocument();
  });

  // Disclosure lands on the row it affected, not only in aggregate.
  it('marks a sponsored result on the result itself', () => {
    render(
      <SearchResults
        query={query}
        results={[result({ sponsored: true })]}
        facets={[]}
        totalCount={1}
        noResults={null}
      />,
    );
    expect(screen.getByText('Paid placement')).toBeInTheDocument();
  });

  it('surfaces a stale field rather than hiding that a figure is being confirmed', () => {
    render(
      <SearchResults
        query={query}
        results={[result({ staleFields: ['tuitionFee'] })]}
        facets={[]}
        totalCount={1}
        noResults={null}
      />,
    );
    expect(screen.getByText(/confirming tuitionfee/i)).toBeInTheDocument();
  });
});

describe('the zero-result rule', () => {
  const diagnosis = {
    explanation: 'Nothing matches all 2 of your filters at once. Each one below would bring results back on its own.',
    relaxable: [
      { field: 'level' as const, label: 'Level', wouldReturn: 31, suggestion: 'Include another study level' },
      { field: 'country' as const, label: 'Country', wouldReturn: 4, suggestion: 'Include more destinations' },
    ],
  };

  it('never renders a bare zero, and always explains why', () => {
    render(
      <SearchResults
        query={ProgramSearchQuerySchema.parse({ level: ['doctorate'], country: ['GB'] })}
        results={[]}
        facets={[]}
        totalCount={0}
        noResults={diagnosis}
      />,
    );
    expect(screen.getByText(diagnosis.explanation)).toBeInTheDocument();
    // `EmptyState` is also a status region, so target the count by its text
    // rather than by role.
    const count = screen.getByText('No programmes match your filters');
    expect(count).toHaveAttribute('aria-live', 'polite');
  });

  it('offers each relaxable filter as a real control with what it would recover', () => {
    render(
      <SearchResults
        query={ProgramSearchQuerySchema.parse({ level: ['doctorate'], country: ['GB'] })}
        results={[]}
        facets={[]}
        totalCount={0}
        noResults={diagnosis}
      />,
    );
    expect(screen.getByText('31 programmes would come back')).toBeInTheDocument();

    // And the control actually relaxes the filter it names.
    push.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /include another study level/i }));
    expect(push).toHaveBeenCalledTimes(1);
    const target = push.mock.calls[0][0] as string;
    expect(target).not.toContain('level=');
    expect(target).toContain('country=GB');
  });

  it('offers a clear-all when no single filter is the culprit', () => {
    render(
      <SearchResults
        query={ProgramSearchQuerySchema.parse({ level: ['doctorate'] })}
        results={[]}
        facets={[]}
        totalCount={0}
        noResults={{ explanation: 'Your filters rule out everything.', relaxable: [] }}
      />,
    );
    expect(screen.getByRole('button', { name: /clear all filters/i })).toBeInTheDocument();
  });
});
