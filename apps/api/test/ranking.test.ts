import { describe, expect, it } from 'vitest';
import {
  ProgramSearchQuerySchema,
  StudentProfileSchema,
  type ProgramSearchQuery,
  type StudentProfile,
} from '@modex/contracts';
import {
  rankDocuments,
  requiresDisclosure,
  scoreDocument,
  SPONSORED_TIEBREAK,
} from '../src/search/ranking.js';
import type { SearchDocument } from '../src/search/search-index.port.js';

function doc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    programKey: 'prog-a',
    programId: 'p_1',
    version: 1,
    name: 'MSc Data Science',
    description: 'A taught masters in data science.',
    level: 'postgraduate_taught',
    discipline: 'Computer Science',
    language: 'English',
    institutionId: 'inst_1',
    institutionName: 'University of Example',
    institutionVerified: true,
    country: 'GB',
    city: 'Manchester',
    durationMonths: 12,
    tuitionMinor: 2_400_000,
    tuitionCurrency: 'GBP',
    applicationFeeMinor: 5_000,
    intakes: ['2027-09'],
    nextDeadline: new Date('2027-07-01T00:00:00.000Z'),
    scholarshipAvailable: false,
    discountAvailable: false,
    sponsored: false,
    visible: true,
    staleFields: [],
    syncState: 'synced',
    searchText: 'MSc Data Science Computer Science University of Example Manchester',
    ...overrides,
  };
}

function query(overrides: Partial<ProgramSearchQuery> = {}): ProgramSearchQuery {
  return ProgramSearchQuerySchema.parse({ ...overrides });
}

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return StudentProfileSchema.parse({
    id: 'sp_1',
    userId: 'user_1',
    dateOfBirth: null,
    nationality: 'NG',
    countryOfResidence: 'NG',
    intendedLevel: 'postgraduate_taught',
    intendedField: 'Computer Science',
    preferredCountries: ['GB'],
    budgetPerYear: { amountMinor: 2_500_000, currency: 'GBP' },
    targetIntake: '2027-09',
    academicRecords: [],
    languageTests: [],
    workExperienceMonths: null,
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('sponsored placement', () => {
  // The promise the whole platform is built on. If this test ever fails, the
  // product has become the thing it exists to replace.
  it('cannot move a sponsored programme above a better match', () => {
    const sponsored = doc({
      programKey: 'sponsored',
      // A worse match on every substantive factor.
      level: 'undergraduate',
      discipline: 'History',
      institutionVerified: false,
      sponsored: true,
    });
    const better = doc({ programKey: 'better' });

    const ranked = rankDocuments([sponsored, better], query(), profile());
    expect(ranked.map((entry) => entry.document.programKey)).toEqual(['better', 'sponsored']);
  });

  it('breaks a tie between otherwise identical programmes, and only a tie', () => {
    const plain = doc({ programKey: 'a-plain' });
    // `a-plain` sorts first alphabetically, so if sponsorship did nothing at
    // all, it would win. It is the tiebreak that reverses this, which is
    // exactly the scope sponsorship is allowed.
    const sponsored = doc({ programKey: 'b-sponsored', sponsored: true });

    const ranked = rankDocuments([plain, sponsored], query(), profile());
    expect(ranked[0].document.programKey).toBe('b-sponsored');
  });

  it('keeps the tiebreak smaller than every substantive weight', () => {
    const factors = scoreDocument(doc(), query(), profile()).factors;
    const substantive = factors.filter((factor) => factor.factor !== 'sponsored_placement');
    for (const factor of substantive) {
      expect(factor.weight).toBeGreaterThan(SPONSORED_TIEBREAK);
    }
  });

  it('discloses itself on the result, not just in aggregate', () => {
    const ranked = rankDocuments([doc({ sponsored: true })], query(), profile());
    const factor = ranked[0].factors.find((f) => f.factor === 'sponsored_placement');
    expect(factor).toBeDefined();
    expect(factor!.explanation).toMatch(/pays modex/i);
    expect(requiresDisclosure(ranked)).toBe(true);
    expect(requiresDisclosure(rankDocuments([doc()], query(), profile()))).toBe(false);
  });
});

describe('determinism and explainability', () => {
  it('returns the same order for the same inputs', () => {
    const documents = [doc({ programKey: 'a' }), doc({ programKey: 'b' }), doc({ programKey: 'c' })];
    const first = rankDocuments(documents, query({ q: 'data' }), profile());
    const second = rankDocuments([...documents].reverse(), query({ q: 'data' }), profile());
    expect(first.map((r) => r.document.programKey)).toEqual(
      second.map((r) => r.document.programKey),
    );
  });

  it('explains every factor, including the ones that contributed nothing', () => {
    const ranked = scoreDocument(doc(), query(), null);
    expect(ranked.factors.length).toBeGreaterThanOrEqual(6);
    for (const factor of ranked.factors) {
      expect(factor.explanation.length).toBeGreaterThan(10);
      expect(factor.contribution).toBeCloseTo(factor.rawScore * factor.weight, 10);
    }
    // The score is exactly the sum of what was shown. A score with an
    // unexplained remainder would make the explanation decorative.
    const summed = ranked.factors.reduce((total, factor) => total + factor.contribution, 0);
    expect(ranked.score).toBeCloseTo(summed, 10);
  });

  it('scores a profile match above a stranger', () => {
    const matching = scoreDocument(doc(), query(), profile());
    const anonymous = scoreDocument(doc(), query(), null);
    expect(matching.score).toBeGreaterThan(anonymous.score);
  });
});

describe('sorting', () => {
  // A programme with no published fee is not the cheapest one, and a programme
  // with no deadline is not the most urgent. Coercing null to zero would put
  // exactly those rows at the top.
  it('sorts a missing figure last, in both directions', () => {
    const priced = doc({ programKey: 'priced', tuitionMinor: 1_000_000 });
    const unpriced = doc({ programKey: 'unpriced', tuitionMinor: null });

    expect(
      rankDocuments([unpriced, priced], query({ sort: 'tuition_asc' }), null).map(
        (r) => r.document.programKey,
      ),
    ).toEqual(['priced', 'unpriced']);

    expect(
      rankDocuments([unpriced, priced], query({ sort: 'tuition_desc' }), null).map(
        (r) => r.document.programKey,
      ),
    ).toEqual(['priced', 'unpriced']);
  });

  it('sorts by deadline, soonest first, with no deadline last', () => {
    const soon = doc({ programKey: 'soon', nextDeadline: new Date('2027-01-01T00:00:00.000Z') });
    const later = doc({ programKey: 'later', nextDeadline: new Date('2027-09-01T00:00:00.000Z') });
    const never = doc({ programKey: 'never', nextDeadline: null });

    expect(
      rankDocuments([never, later, soon], query({ sort: 'deadline_asc' }), null).map(
        (r) => r.document.programKey,
      ),
    ).toEqual(['soon', 'later', 'never']);
  });

  it('sorts by duration ascending', () => {
    const short = doc({ programKey: 'short', durationMonths: 12 });
    const long = doc({ programKey: 'long', durationMonths: 24 });
    expect(
      rankDocuments([long, short], query({ sort: 'duration_asc' }), null).map(
        (r) => r.document.programKey,
      ),
    ).toEqual(['short', 'long']);
  });
});

describe('budget matching', () => {
  // Ranking across currencies would mean picking an exchange rate and
  // presenting the result as a fact. Abstaining is the honest answer.
  it('abstains rather than inventing an exchange rate', () => {
    const euro = doc({ tuitionCurrency: 'EUR', tuitionMinor: 100 });
    const factor = scoreDocument(euro, query(), profile()).factors.find(
      (f) => f.factor === 'within_budget',
    );
    expect(factor!.rawScore).toBe(0);
    expect(factor!.explanation).toMatch(/did not compare/i);
  });

  it('rewards a programme inside the student\'s budget', () => {
    const cheap = scoreDocument(doc({ tuitionMinor: 1_000_000 }), query(), profile());
    const dear = scoreDocument(doc({ tuitionMinor: 9_000_000 }), query(), profile());
    expect(cheap.score).toBeGreaterThan(dear.score);
  });
});
