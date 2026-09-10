import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  diagnoseNoResults,
  ProgramSearchQuerySchema,
  type ProgramSearchQuery,
} from '../src/domain/search.js';

function query(overrides: Partial<ProgramSearchQuery> = {}): ProgramSearchQuery {
  return ProgramSearchQuerySchema.parse({ ...overrides });
}

describe('active filters', () => {
  it('counts a one-sided tuition range as a tuition filter', () => {
    expect(activeFilters(query({ tuitionMaxMinor: 2_000_000 }))).toEqual(['tuition']);
    expect(activeFilters(query({ tuitionMinMinor: 100_000 }))).toEqual(['tuition']);
  });

  it('ignores a free-text term, which is not a filter to relax', () => {
    expect(activeFilters(query({ q: 'data science' }))).toEqual([]);
  });

  it('counts a false boolean facet as active', () => {
    // `scholarshipAvailable: false` means "show me ones without", which is a
    // constraint. Only `null` means unset — a plain truthiness check here would
    // silently drop the filter from the diagnosis.
    expect(activeFilters(query({ scholarshipAvailable: false }))).toEqual([
      'scholarshipAvailable',
    ]);
  });
});

describe('zero-result diagnosis', () => {
  // "Never a bare 0 results" is the rule; every branch below returns prose.
  it('explains an empty catalogue rather than blaming the student', () => {
    const diagnosis = diagnoseNoResults(query(), {});
    expect(diagnosis.explanation).toMatch(/no published programmes/i);
    expect(diagnosis.relaxable).toEqual([]);
  });

  it('suggests a broader term when only free text is set', () => {
    const diagnosis = diagnoseNoResults(query({ q: 'quantum basket weaving' }), {});
    expect(diagnosis.explanation).toContain('quantum basket weaving');
    expect(diagnosis.explanation).toMatch(/broader/i);
  });

  it('offers the filters that actually recover results, most first', () => {
    const diagnosis = diagnoseNoResults(
      query({ country: ['GB'], level: ['doctorate'], durationMaxMonths: 12 }),
      { country: 4, level: 31, duration: 9 },
    );
    expect(diagnosis.relaxable.map((filter) => filter.field)).toEqual([
      'level',
      'duration',
      'country',
    ]);
    expect(diagnosis.explanation).toMatch(/all 3 of your filters/i);
    for (const filter of diagnosis.relaxable) {
      expect(filter.suggestion.length).toBeGreaterThan(0);
      expect(filter.wouldReturn).toBeGreaterThan(0);
    }
  });

  // Offering a filter whose removal recovers nothing wastes the student's time
  // and reads as the interface guessing.
  it('leaves out a filter that recovers nothing on its own', () => {
    const diagnosis = diagnoseNoResults(query({ country: ['GB'], level: ['doctorate'] }), {
      country: 0,
      level: 6,
    });
    expect(diagnosis.relaxable.map((filter) => filter.field)).toEqual(['level']);
  });

  it('says so plainly when no single filter is the culprit', () => {
    const diagnosis = diagnoseNoResults(query({ country: ['GB'], level: ['doctorate'] }), {
      country: 0,
      level: 0,
    });
    expect(diagnosis.relaxable).toEqual([]);
    expect(diagnosis.explanation).toMatch(/each one on its own/i);
    expect(diagnosis.explanation).not.toMatch(/^0 results/);
  });
});
