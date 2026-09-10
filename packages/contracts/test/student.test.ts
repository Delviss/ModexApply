import { describe, expect, it } from 'vitest';
import {
  convertGrade,
  formatGrade,
  isAscendingScale,
  meetsThreshold,
} from '../src/domain/grades.js';
import {
  gapsBlocking,
  highestQualification,
  isTestCurrent,
  profileCompleteness,
  StudentProfileSchema,
  type StudentProfile,
} from '../src/domain/student.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

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
        grade: { scale: 'gpa_5', value: 4.2 },
        startedAt: '2021-09-01T00:00:00.000Z',
        completedAt: '2025-07-01T00:00:00.000Z',
      },
    ],
    languageTests: [
      {
        test: 'ielts',
        overall: 7,
        bands: { writing: 6.5, speaking: 7 },
        takenAt: '2026-01-10T00:00:00.000Z',
        expiresAt: '2028-01-10T00:00:00.000Z',
      },
    ],
    workExperienceMonths: 12,
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('grade scales', () => {
  // The trap: on uk_class a First is 1 and a Third is 3, so "at least a 2:1"
  // is numerically `<= 2.1`. A rule authored the way a registrar would phrase
  // it must still mean what they meant.
  it('reads a UK classification threshold in the direction the scale runs', () => {
    expect(meetsThreshold(1, 'gte', 2.1, 'uk_class')).toBe(true);
    expect(meetsThreshold(2.1, 'gte', 2.1, 'uk_class')).toBe(true);
    expect(meetsThreshold(2.2, 'gte', 2.1, 'uk_class')).toBe(false);
    expect(isAscendingScale('uk_class')).toBe(false);
  });

  it('reads an ascending scale the ordinary way', () => {
    expect(meetsThreshold(3.4, 'gte', 3.0, 'gpa_4')).toBe(true);
    expect(meetsThreshold(2.8, 'gte', 3.0, 'gpa_4')).toBe(false);
    expect(meetsThreshold(72, 'gte', 70, 'percentage')).toBe(true);
  });

  it('converts with a source the student can be shown', () => {
    const converted = convertGrade({ scale: 'gpa_4', value: 3.5 }, 'uk_class');
    expect(converted).not.toBeNull();
    expect(converted?.value).toBe(2.1);
    expect(converted?.sourceRef).toMatch(/^https?:\/\//);
    expect(converted?.note).toContain('Upper second');
  });

  it('handles the top of a band, which is half-open above', () => {
    expect(convertGrade({ scale: 'gpa_4', value: 4.0 }, 'uk_class')?.value).toBe(1);
    expect(convertGrade({ scale: 'percentage', value: 100 }, 'uk_class')?.value).toBe(1);
  });

  // Refusing beats interpolating. The engine turns a null into `unknown`, and
  // `unknown` is not `fail` — which is the distinction the whole phase turns on.
  it('refuses a pair it has no published table for, rather than guessing', () => {
    expect(convertGrade({ scale: 'uk_class', value: 2.1 }, 'gpa_4')).toBeNull();
    expect(convertGrade({ scale: 'ects_grade', value: 4 }, 'uk_class')).toBeNull();
  });

  it('says the grade the way a student would', () => {
    expect(formatGrade({ scale: 'uk_class', value: 2.1 })).toBe('an Upper second (2:1)');
    expect(formatGrade({ scale: 'percentage', value: 68 })).toBe('68%');
  });
});

describe('profile completeness', () => {
  it('is a list of what is missing, never a likelihood', () => {
    const result = profileCompleteness(profile());
    expect(result.missing).toEqual([]);
    expect(result.completed).toBe(result.total);

    // The hard product boundary, asserted on the shape rather than on copy: no
    // field here can be bound to an "admission chance" meter by mistake.
    for (const key of Object.keys(result)) {
      expect(key).not.toMatch(/score|probability|chance|likelihood|odds/i);
    }
  });

  it('names the missing field and what filling it unlocks', () => {
    const result = profileCompleteness(profile({ languageTests: [], nationality: null }));
    const fields = result.missing.map((gap) => gap.field);
    expect(fields).toContain('languageTests');
    expect(fields).toContain('nationality');
    expect(result.completed).toBe(result.total - 2);
    for (const gap of result.missing) {
      expect(gap.label.length).toBeGreaterThan(0);
      expect(gap.unlocks.length).toBeGreaterThan(0);
    }
  });

  // Progressive onboarding: a student can search before completing everything,
  // and is asked for exactly what the action in front of them needs.
  it('narrows to the gaps blocking one specific action', () => {
    const incomplete = profile({ languageTests: [], budgetPerYear: null });
    const gaps = gapsBlocking(incomplete, ['languageTests']);
    expect(gaps.map((gap) => gap.field)).toEqual(['languageTests']);
  });

  it('counts a record with no grade as a gap of its own', () => {
    const noGrade = profile({
      academicRecords: [
        {
          level: 'bachelors',
          institutionName: 'University of Lagos',
          countryCode: 'NG',
          fieldOfStudy: 'Computer Science',
          grade: null,
          startedAt: '2021-09-01T00:00:00.000Z',
          completedAt: '2025-07-01T00:00:00.000Z',
        },
      ],
    });
    const fields = profileCompleteness(noGrade).missing.map((gap) => gap.field);
    expect(fields).toContain('academicGrade');
    expect(fields).not.toContain('academicRecords');
  });
});

describe('profile helpers', () => {
  it('picks the highest qualification, not the most recent', () => {
    const both = profile({
      academicRecords: [
        {
          level: 'masters',
          institutionName: 'A',
          countryCode: 'NG',
          fieldOfStudy: 'CS',
          grade: null,
          startedAt: '2019-09-01T00:00:00.000Z',
          completedAt: '2021-07-01T00:00:00.000Z',
        },
        {
          level: 'bachelors',
          institutionName: 'B',
          countryCode: 'NG',
          fieldOfStudy: 'CS',
          grade: null,
          startedAt: '2021-09-01T00:00:00.000Z',
          completedAt: '2025-07-01T00:00:00.000Z',
        },
      ],
    });
    expect(highestQualification(both)?.level).toBe('masters');
    expect(highestQualification(profile({ academicRecords: [] }))).toBeNull();
  });

  it('treats a lapsed language test as lapsed', () => {
    const [test] = profile().languageTests;
    expect(isTestCurrent(test, NOW)).toBe(true);
    expect(isTestCurrent({ ...test, expiresAt: '2026-03-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isTestCurrent({ ...test, expiresAt: null }, NOW)).toBe(true);
  });
});
