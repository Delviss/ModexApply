import { describe, expect, it } from 'vitest';
import {
  parseSearchParams,
  toSearchString,
  toggleFacetValue,
  withoutFacet,
} from '@/lib/search-params';

describe('search URL state', () => {
  it('round-trips a query through the query string', () => {
    const query = parseSearchParams({
      q: 'data science',
      country: 'GB,IE',
      level: 'postgraduate_taught',
      tuitionMaxMinor: '2400000',
      scholarshipAvailable: 'true',
      sort: 'tuition_asc',
    });

    expect(query.country).toEqual(['GB', 'IE']);
    expect(query.tuitionMaxMinor).toBe(2_400_000);
    expect(query.scholarshipAvailable).toBe(true);

    const round = parseSearchParams(
      Object.fromEntries(new URLSearchParams(toSearchString(query).slice(1))),
    );
    expect(round.country).toEqual(['GB', 'IE']);
    expect(round.q).toBe('data science');
    expect(round.sort).toBe('tuition_asc');
  });

  it('omits defaults, so a plain search has a clean URL', () => {
    expect(toSearchString(parseSearchParams({}))).toBe('');
  });

  it('keeps `false` on a boolean facet, which is a filter and not an absence', () => {
    const query = parseSearchParams({ scholarshipAvailable: 'false' });
    expect(query.scholarshipAvailable).toBe(false);
    expect(toSearchString(query)).toContain('scholarshipAvailable=false');
  });

  // A URL somebody truncated in a message should still open a usable page.
  it('falls back to an unfiltered search rather than erroring on nonsense', () => {
    const query = parseSearchParams({ level: 'not-a-level', tuitionMaxMinor: 'abc' });
    expect(query.level).toEqual([]);
    expect(query.tuitionMaxMinor).toBeNull();
  });

  it('drops a facet completely when relaxing it', () => {
    const query = parseSearchParams({ level: 'doctorate', tuitionMaxMinor: '100' });
    expect(withoutFacet(query, 'level').level).toEqual([]);
    expect(withoutFacet(query, 'tuition').tuitionMaxMinor).toBeNull();
  });

  it('toggles a facet value and forgets the page cursor', () => {
    const query = { ...parseSearchParams({ country: 'GB' }), cursor: 'abc' };
    const added = toggleFacetValue(query, 'country', 'IE');
    expect(added.country).toEqual(['GB', 'IE']);
    // The cursor pointed into a result set that no longer exists.
    expect(added.cursor).toBeUndefined();

    expect(toggleFacetValue(added, 'country', 'GB').country).toEqual(['IE']);
  });
});
