import { z } from 'zod';
import { MoneySchema } from '../primitives/money.js';
import { GRADE_SCALES, GradeSchema } from './grades.js';
import { PROGRAM_LEVELS } from './catalogue.js';

/**
 * The student's reusable profile (Phase 2 §1, FR-001/FR-002).
 *
 * Stored separately from `User` identity data: a profile carries academic
 * history and test scores, which are shared with universities under consent,
 * while identity carries credentials, which never are.
 */

export const LANGUAGE_TESTS = [
  'ielts',
  'toefl_ibt',
  'pte',
  'duolingo',
  'cambridge',
  'moi_waiver',
] as const;
export type LanguageTestName = (typeof LANGUAGE_TESTS)[number];

export const LanguageTestSchema = z.object({
  test: z.enum(LANGUAGE_TESTS),
  overall: z.number(),
  /** Per-band scores, keyed as the test publishes them: listening, writing… */
  bands: z.record(z.string(), z.number()).default({}),
  takenAt: z.iso.datetime(),
  /**
   * Language tests expire, usually two years in. An expired test is not a
   * missing test and not a failing one — it is a specific, fixable thing, and
   * the vault reminds the student before it becomes urgent.
   */
  expiresAt: z.iso.datetime().nullable(),
});

export type LanguageTest = z.infer<typeof LanguageTestSchema>;

export function isTestCurrent(test: LanguageTest, now: Date = new Date()): boolean {
  return test.expiresAt === null || new Date(test.expiresAt) > now;
}

export const ACADEMIC_LEVELS = [
  'high_school',
  'diploma',
  'bachelors',
  'masters',
  'doctorate',
] as const;
export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];

export const AcademicRecordSchema = z.object({
  level: z.enum(ACADEMIC_LEVELS),
  institutionName: z.string().min(1),
  /** ISO 3166-1 alpha-2 of the awarding country — nationality rules turn on it. */
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  fieldOfStudy: z.string().min(1),
  grade: GradeSchema.nullable(),
  startedAt: z.iso.datetime(),
  /** Null means in progress. An unfinished degree is not a missing one. */
  completedAt: z.iso.datetime().nullable(),
});

export type AcademicRecord = z.infer<typeof AcademicRecordSchema>;

export const StudentProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  dateOfBirth: z.iso.date().nullable(),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  countryOfResidence: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),

  // What they are looking for.
  intendedLevel: z.enum(PROGRAM_LEVELS).nullable(),
  intendedField: z.string().nullable(),
  preferredCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
  budgetPerYear: MoneySchema.nullable(),
  /** Target intake as `YYYY-MM`, which is how intakes are actually discussed. */
  targetIntake: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),

  academicRecords: z.array(AcademicRecordSchema).default([]),
  languageTests: z.array(LanguageTestSchema).default([]),
  workExperienceMonths: z.number().int().min(0).nullable(),

  updatedAt: z.iso.datetime(),
});

export type StudentProfile = z.infer<typeof StudentProfileSchema>;

/** The grade scales a profile can express, re-exported so form code has one import. */
export const PROFILE_GRADE_SCALES = GRADE_SCALES;

/**
 * ---------------------------------------------------------------------------
 * Completeness
 * ---------------------------------------------------------------------------
 *
 * A **completeness indicator, not a probability score** (Phase 2 §1). It shows
 * what is missing. It is never an admission likelihood, and this is a hard
 * product boundary rather than a copy preference — so the returned type has no
 * `score`, no `probability` and no `chance` field for a well-meaning UI to bind
 * to. The only number here is "how many of these fields are filled in", which
 * cannot be mistaken for a prediction about a university's decision.
 */
export interface FieldGap {
  field: string;
  /** What the student is being asked for, in their words. */
  label: string;
  /** What this unlocks — so the ask is justified at the moment it is made. */
  unlocks: string;
}

export interface ProfileCompleteness {
  completed: number;
  total: number;
  missing: FieldGap[];
}

interface CompletenessRule {
  field: string;
  label: string;
  unlocks: string;
  filled: (profile: StudentProfile) => boolean;
}

const COMPLETENESS_RULES: readonly CompletenessRule[] = Object.freeze([
  {
    field: 'nationality',
    label: 'Your nationality',
    unlocks: 'Checks for programmes that restrict applications by nationality',
    filled: (p) => p.nationality !== null,
  },
  {
    field: 'dateOfBirth',
    label: 'Your date of birth',
    unlocks: 'Checks for programmes with a minimum age',
    filled: (p) => p.dateOfBirth !== null,
  },
  {
    field: 'intendedLevel',
    label: 'The level you want to study at',
    unlocks: 'Narrowing search to programmes at your level',
    filled: (p) => p.intendedLevel !== null,
  },
  {
    field: 'intendedField',
    label: 'The subject you want to study',
    unlocks: 'Narrowing search to your field',
    filled: (p) => p.intendedField !== null && p.intendedField.length > 0,
  },
  {
    field: 'preferredCountries',
    label: 'Where you would like to study',
    unlocks: 'Filtering by destination',
    filled: (p) => p.preferredCountries.length > 0,
  },
  {
    field: 'budgetPerYear',
    label: 'Your budget per year',
    unlocks: 'Filtering out programmes you would have to withdraw from',
    filled: (p) => p.budgetPerYear !== null,
  },
  {
    field: 'targetIntake',
    label: 'When you want to start',
    unlocks: 'Showing intakes you can still apply for',
    filled: (p) => p.targetIntake !== null,
  },
  {
    field: 'academicRecords',
    label: 'Your academic history',
    unlocks: 'Checks for prior-qualification and grade requirements',
    filled: (p) => p.academicRecords.length > 0,
  },
  {
    field: 'academicGrade',
    label: 'The grade on your most recent qualification',
    unlocks: 'Checks for minimum grade requirements',
    filled: (p) => p.academicRecords.some((record) => record.grade !== null),
  },
  {
    field: 'languageTests',
    label: 'Your English language test',
    unlocks: 'Checks for language requirements',
    filled: (p) => p.languageTests.length > 0,
  },
]);

export function profileCompleteness(profile: StudentProfile): ProfileCompleteness {
  const missing: FieldGap[] = [];
  for (const rule of COMPLETENESS_RULES) {
    if (!rule.filled(profile)) {
      missing.push({ field: rule.field, label: rule.label, unlocks: rule.unlocks });
    }
  }
  return {
    completed: COMPLETENESS_RULES.length - missing.length,
    total: COMPLETENESS_RULES.length,
    missing,
  };
}

/**
 * The gaps that block one specific action, for progressive onboarding
 * (Phase 2 §1): a student can search before completing everything, and is asked
 * for exactly what the action in front of them needs.
 */
export function gapsBlocking(
  profile: StudentProfile,
  fields: readonly string[],
): FieldGap[] {
  const wanted = new Set(fields);
  return profileCompleteness(profile).missing.filter((gap) => wanted.has(gap.field));
}

/** The most recent completed qualification, which is what requirements test against. */
export function highestQualification(profile: StudentProfile): AcademicRecord | null {
  const order: Record<AcademicLevel, number> = {
    high_school: 1,
    diploma: 2,
    bachelors: 3,
    masters: 4,
    doctorate: 5,
  };
  let best: AcademicRecord | null = null;
  for (const record of profile.academicRecords) {
    if (best === null || order[record.level] > order[best.level]) best = record;
  }
  return best;
}
