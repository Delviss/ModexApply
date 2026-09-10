import { describe, expect, it } from 'vitest';
import {
  RULE_TYPES,
  StudentProfileSchema,
  type RuleType,
  type StudentProfile,
} from '@modex/contracts';
import { evaluateRequirement, type EvaluationContext } from '../src/eligibility/rules.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: NOW,
    usableDocumentTypes: new Set<string>(),
    blockedDocumentTypes: new Map<string, string>(),
    ...overrides,
  };
}

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return StudentProfileSchema.parse({
    id: 'sp_1',
    userId: 'user_1',
    dateOfBirth: '2003-04-11',
    nationality: 'NG',
    countryOfResidence: 'NG',
    intendedLevel: 'postgraduate_taught',
    intendedField: 'Computer Science',
    preferredCountries: ['GB'],
    budgetPerYear: { amountMinor: 2_500_000, currency: 'GBP' },
    targetIntake: '2027-09',
    academicRecords: [
      {
        level: 'bachelors',
        institutionName: 'University of Lagos',
        countryCode: 'NG',
        fieldOfStudy: 'Computer Science',
        grade: { scale: 'gpa_4', value: 3.5 },
        startedAt: '2021-09-01T00:00:00.000Z',
        completedAt: '2025-07-01T00:00:00.000Z',
      },
    ],
    languageTests: [
      {
        test: 'ielts',
        overall: 7,
        bands: { writing: 6.5, speaking: 7, reading: 7, listening: 7 },
        takenAt: '2026-01-10T00:00:00.000Z',
        expiresAt: '2028-01-10T00:00:00.000Z',
      },
    ],
    workExperienceMonths: 24,
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  });
}

function requirement(ruleType: RuleType, ruleJson: unknown, summary = 'A published requirement.') {
  return {
    id: `req_${ruleType}`,
    ruleType,
    ruleJson,
    humanSummary: summary,
    sourceRef: 'https://example.ac.uk/entry-requirements',
  };
}

/** Rules answerable with no profile: they read the vault, or defer to the university. */
const PROFILE_INDEPENDENT = new Set(['document_required', 'portfolio', 'interview']);

/** One parseable payload per rule type, so an invariant can be asserted across all nine. */
const VALID_RULES: Record<RuleType, unknown> = {
  academic_qualification: { ruleType: 'academic_qualification', level: 'bachelors', countries: [] },
  gpa_minimum: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3 },
  english_language: {
    ruleType: 'english_language',
    test: 'ielts',
    overallMinimum: 6.5,
    bandMinimums: {},
  },
  work_experience: { ruleType: 'work_experience', months: 12, field: null },
  portfolio: { ruleType: 'portfolio', format: 'PDF' },
  interview: { ruleType: 'interview', mode: 'online' },
  age_minimum: { ruleType: 'age_minimum', years: 18 },
  nationality_restriction: {
    ruleType: 'nationality_restriction',
    comparison: 'in',
    countries: ['NG'],
  },
  document_required: { ruleType: 'document_required', documentType: 'transcript', certified: false },
};

describe('the three invariants that hold across every rule', () => {
  // An unparseable rule is never a pass. The engine refuses to evaluate a rule
  // it cannot read rather than guessing in either direction.
  it('answers unknown for a rule it cannot parse, never pass and never fail', () => {
    const result = evaluateRequirement(
      requirement('gpa_minimum', { ruleType: 'gpa_minimum', scale: 'martian', value: 'high' }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('unknown');
    expect(result.reason).toMatch(/could not read/i);
  });

  it('answers unknown when ruleType and ruleJson disagree', () => {
    const result = evaluateRequirement(
      requirement('age_minimum', { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3 }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('unknown');
  });

  // An absence is never a rejection. This is the rule the whole phase turns on.
  it('answers missing_data with a remedy when a profile rule has no profile', () => {
    for (const [ruleType, ruleJson] of Object.entries(VALID_RULES)) {
      if (PROFILE_INDEPENDENT.has(ruleType)) continue;
      const result = evaluateRequirement(
        requirement(ruleType as RuleType, ruleJson),
        null,
        context(),
      );
      expect(result.outcome).toBe('missing_data');
      expect(result.remedy).not.toBeNull();
    }
    // Every rule type is covered, so a tenth one added later fails here rather
    // than quietly skipping the invariant.
    expect(Object.keys(VALID_RULES).sort()).toEqual([...RULE_TYPES].sort());
  });

  /**
   * A document requirement reads the vault; a portfolio or interview is the
   * university's call. None of the three needs a profile, so a student who has
   * uploaded a transcript but not filled in their nationality still gets a real
   * answer about the transcript rather than "we need your profile".
   */
  it('answers the profile-independent rules with no profile at all', () => {
    const withDocument = evaluateRequirement(
      requirement('document_required', VALID_RULES.document_required),
      null,
      context({ usableDocumentTypes: new Set(['transcript']) }),
    );
    expect(withDocument.outcome).toBe('pass');

    const withoutDocument = evaluateRequirement(
      requirement('document_required', VALID_RULES.document_required),
      null,
      context(),
    );
    expect(withoutDocument.outcome).toBe('missing_data');
    expect(withoutDocument.remedy).toMatch(/upload your transcript/i);

    for (const ruleType of ['portfolio', 'interview'] as const) {
      const result = evaluateRequirement(
        requirement(ruleType, VALID_RULES[ruleType]),
        null,
        context(),
      );
      expect(result.outcome).toBe('unknown');
    }
  });

  // An unreadable rule wins over a missing profile: we cannot say what the
  // student is missing when we cannot say what is being asked for.
  it('prefers unknown over missing_data when the rule itself is unreadable', () => {
    const result = evaluateRequirement(requirement('gpa_minimum', {}), null, context());
    expect(result.outcome).toBe('unknown');
  });

  it('echoes the human summary and the source so a row is readable and contestable', () => {
    const result = evaluateRequirement(
      requirement('age_minimum', { ruleType: 'age_minimum', years: 18 }, 'You must be 18 or over.'),
      profile(),
      context(),
    );
    expect(result.requirement).toBe('You must be 18 or over.');
    expect(result.sourceRef).toBe('https://example.ac.uk/entry-requirements');
  });

  it('never throws, whatever it is handed', () => {
    for (const ruleType of RULE_TYPES) {
      for (const payload of [null, undefined, 42, 'nonsense', {}, []]) {
        expect(() =>
          evaluateRequirement(requirement(ruleType, payload), profile(), context()),
        ).not.toThrow();
      }
    }
  });
});

describe('academic qualification', () => {
  const rule = { ruleType: 'academic_qualification', level: 'bachelors', countries: [] };

  it('passes a qualification at or above the required level', () => {
    const result = evaluateRequirement(
      requirement('academic_qualification', rule),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('pass');
    expect(result.studentValue).toContain('University of Lagos');
  });

  it('fails a qualification below the required level', () => {
    const result = evaluateRequirement(
      requirement('academic_qualification', { ...rule, level: 'masters' }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('fail');
  });

  // A degree in progress is ordinary, and conditional offers exist for exactly
  // this case. Treating it as absent would steer people away wrongly.
  it('passes an in-progress degree, flagging that an offer would be conditional', () => {
    const inProgress = profile({
      academicRecords: [
        {
          level: 'bachelors',
          institutionName: 'University of Lagos',
          countryCode: 'NG',
          fieldOfStudy: 'CS',
          grade: null,
          startedAt: '2023-09-01T00:00:00.000Z',
          completedAt: null,
        },
      ],
    });
    const result = evaluateRequirement(requirement('academic_qualification', rule), inProgress, context());
    expect(result.outcome).toBe('pass');
    expect(result.reason).toMatch(/conditional/i);
  });

  // Recognition is the university's judgement, not ours. `unknown` says so.
  it('defers to the university when the awarding country is not on the list', () => {
    const result = evaluateRequirement(
      requirement('academic_qualification', { ...rule, countries: ['GB', 'IE'] }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('unknown');
    expect(result.remedy).toMatch(/ask the university/i);
  });
});

describe('grade minimums', () => {
  it('shows the conversion that judged the student', () => {
    const result = evaluateRequirement(
      requirement('gpa_minimum', {
        ruleType: 'gpa_minimum',
        scale: 'uk_class',
        comparison: 'gte',
        value: 2.1,
      }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('pass');
    // The arithmetic is visible: a 3.5/4.0 reaching a 2:1 is a claim the
    // student can check and dispute.
    expect(result.studentValue).toContain('3.5');
    expect(result.studentValue).toContain('Upper second');
  });

  it('fails a grade below the published minimum', () => {
    const weaker = profile({
      academicRecords: [
        {
          level: 'bachelors',
          institutionName: 'University of Lagos',
          countryCode: 'NG',
          fieldOfStudy: 'CS',
          grade: { scale: 'gpa_4', value: 2.4 },
          startedAt: '2021-09-01T00:00:00.000Z',
          completedAt: '2025-07-01T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(
      requirement('gpa_minimum', {
        ruleType: 'gpa_minimum',
        scale: 'uk_class',
        comparison: 'gte',
        value: 2.1,
      }),
      weaker,
      context(),
    );
    expect(result.outcome).toBe('fail');
  });

  it('answers missing_data when no grade has been added', () => {
    const noGrade = profile({
      academicRecords: [
        {
          level: 'bachelors',
          institutionName: 'X',
          countryCode: 'NG',
          fieldOfStudy: 'CS',
          grade: null,
          startedAt: '2021-09-01T00:00:00.000Z',
          completedAt: '2025-07-01T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(
      requirement('gpa_minimum', {
        ruleType: 'gpa_minimum',
        scale: 'gpa_4',
        comparison: 'gte',
        value: 3,
      }),
      noGrade,
      context(),
    );
    expect(result.outcome).toBe('missing_data');
    expect(result.remedy).toMatch(/add the grade/i);
  });

  // No published conversion means no judgement. Guessing here is how a student
  // gets told "not eligible" by an interpolation nobody reviewed.
  it('answers unknown when no published conversion covers the pair', () => {
    const ukStudent = profile({
      academicRecords: [
        {
          level: 'bachelors',
          institutionName: 'X',
          countryCode: 'GB',
          fieldOfStudy: 'CS',
          grade: { scale: 'uk_class', value: 2.1 },
          startedAt: '2021-09-01T00:00:00.000Z',
          completedAt: '2025-07-01T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(
      requirement('gpa_minimum', {
        ruleType: 'gpa_minimum',
        scale: 'gpa_4',
        comparison: 'gte',
        value: 3,
      }),
      ukStudent,
      context(),
    );
    expect(result.outcome).toBe('unknown');
    expect(result.reason).toMatch(/no published conversion/i);
  });
});

describe('english language', () => {
  const rule = {
    ruleType: 'english_language',
    test: 'ielts',
    overallMinimum: 6.5,
    bandMinimums: { writing: 6 },
  };

  it('passes when the overall and every band minimum are met', () => {
    const result = evaluateRequirement(requirement('english_language', rule), profile(), context());
    expect(result.outcome).toBe('pass');
  });

  // A 6.5 overall with a 5.0 in writing usually still fails. Checking only the
  // overall is the classic version of this bug.
  it('fails a passing overall with a short band', () => {
    const shortBand = profile({
      languageTests: [
        {
          test: 'ielts',
          overall: 6.5,
          bands: { writing: 5 },
          takenAt: '2026-01-10T00:00:00.000Z',
          expiresAt: '2028-01-10T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(requirement('english_language', rule), shortBand, context());
    expect(result.outcome).toBe('fail');
    expect(result.reason).toMatch(/per-section/i);
  });

  it('answers missing_data when a required band was never entered', () => {
    const noBands = profile({
      languageTests: [
        {
          test: 'ielts',
          overall: 7,
          bands: {},
          takenAt: '2026-01-10T00:00:00.000Z',
          expiresAt: '2028-01-10T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(requirement('english_language', rule), noBands, context());
    expect(result.outcome).toBe('missing_data');
    expect(result.remedy).toMatch(/writing/i);
  });

  // An expired test is a specific, fixable thing, not a failing score.
  it('treats an expired test as missing data, not as a fail', () => {
    const expired = profile({
      languageTests: [
        {
          test: 'ielts',
          overall: 8,
          bands: { writing: 8 },
          takenAt: '2023-01-10T00:00:00.000Z',
          expiresAt: '2025-01-10T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(requirement('english_language', rule), expired, context());
    expect(result.outcome).toBe('missing_data');
    expect(result.reason).toMatch(/expired/i);
  });

  it('names the test the student did add when it is the wrong one', () => {
    const wrongTest = profile({
      languageTests: [
        {
          test: 'toefl_ibt',
          overall: 100,
          bands: {},
          takenAt: '2026-01-10T00:00:00.000Z',
          expiresAt: '2028-01-10T00:00:00.000Z',
        },
      ],
    });
    const result = evaluateRequirement(requirement('english_language', rule), wrongTest, context());
    expect(result.outcome).toBe('missing_data');
    expect(result.reason).toContain('TOEFL_IBT');
  });
});

describe('documents', () => {
  const rule = { ruleType: 'document_required', documentType: 'transcript', certified: false };

  it('passes when the vault holds a scanned, usable copy', () => {
    const result = evaluateRequirement(
      requirement('document_required', rule),
      profile(),
      context({ usableDocumentTypes: new Set(['transcript']) }),
    );
    expect(result.outcome).toBe('pass');
  });

  // The load-bearing case: a quarantined transcript is missing data, never a
  // pass. Saying "you have it" would be false at the moment it matters.
  it('treats a blocked document as missing data, never as held', () => {
    const result = evaluateRequirement(
      requirement('document_required', rule),
      profile(),
      context({
        blockedDocumentTypes: new Map([['transcript', 'This file was blocked by our malware scan.']]),
      }),
    );
    expect(result.outcome).toBe('missing_data');
    expect(result.reason).toMatch(/malware/i);
    expect(result.studentValue).toMatch(/not usable/i);
  });

  it('defers a certified-copy requirement to the university', () => {
    const result = evaluateRequirement(
      requirement('document_required', { ...rule, certified: true }),
      profile(),
      context({ usableDocumentTypes: new Set(['transcript']) }),
    );
    expect(result.outcome).toBe('unknown');
  });

  it('asks for the document when the vault has none', () => {
    const result = evaluateRequirement(requirement('document_required', rule), profile(), context());
    expect(result.outcome).toBe('missing_data');
    expect(result.remedy).toMatch(/upload your transcript/i);
  });
});

describe('the remaining rule types', () => {
  it('computes age against the evaluation clock, not the wall clock', () => {
    const result = evaluateRequirement(
      requirement('age_minimum', { ruleType: 'age_minimum', years: 18 }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('pass');
    expect(result.studentValue).toBe('23 years old');

    const tooYoung = evaluateRequirement(
      requirement('age_minimum', { ruleType: 'age_minimum', years: 25 }),
      profile(),
      context(),
    );
    expect(tooYoung.outcome).toBe('fail');
  });

  it('applies a nationality restriction in both directions', () => {
    const excluded = evaluateRequirement(
      requirement('nationality_restriction', {
        ruleType: 'nationality_restriction',
        comparison: 'not_in',
        countries: ['NG'],
      }),
      profile(),
      context(),
    );
    expect(excluded.outcome).toBe('fail');

    const included = evaluateRequirement(
      requirement('nationality_restriction', {
        ruleType: 'nationality_restriction',
        comparison: 'in',
        countries: ['NG', 'GH'],
      }),
      profile(),
      context(),
    );
    expect(included.outcome).toBe('pass');
  });

  // We record duration, not sector. Claiming a pass on relevance we cannot see
  // would be inventing a judgement the university has to make.
  it('will not claim work experience is relevant when it only knows the length', () => {
    const result = evaluateRequirement(
      requirement('work_experience', { ruleType: 'work_experience', months: 12, field: 'nursing' }),
      profile(),
      context(),
    );
    expect(result.outcome).toBe('unknown');
    expect(result.studentValue).toBe('24 months');

    const anyField = evaluateRequirement(
      requirement('work_experience', { ruleType: 'work_experience', months: 12, field: null }),
      profile(),
      context(),
    );
    expect(anyField.outcome).toBe('pass');
  });

  it('leaves portfolio and interview to the university', () => {
    expect(
      evaluateRequirement(
        requirement('portfolio', { ruleType: 'portfolio', format: 'PDF' }),
        profile(),
        context(),
      ).outcome,
    ).toBe('unknown');
    expect(
      evaluateRequirement(
        requirement('interview', { ruleType: 'interview', mode: 'online' }),
        profile(),
        context(),
      ).outcome,
    ).toBe('unknown');
  });
});
