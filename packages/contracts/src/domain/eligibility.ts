import { z } from 'zod';
import { RULE_TYPES } from './requirements.js';

/**
 * The eligibility engine returns an *explanation*, never a boolean (Phase 0
 * §2.9). "unknown" and "missing_data" are first-class outcomes: a student who
 * has not uploaded a transcript is not ineligible, they are unassessed, and
 * conflating the two is how a platform quietly steers people away from
 * programmes they would have got into.
 */
export const CHECK_OUTCOMES = ['pass', 'fail', 'unknown', 'missing_data'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export const EligibilityCheckSchema = z.object({
  requirementId: z.string(),
  ruleType: z.enum(RULE_TYPES),
  outcome: z.enum(CHECK_OUTCOMES),
  /** The requirement's human summary, echoed so the row is readable alone. */
  requirement: z.string(),
  /** What the student's profile actually provided, in plain words. */
  studentValue: z.string().nullable(),
  /** Why this outcome — shown verbatim in `<EligibilityExplanation>`. */
  reason: z.string(),
  /** Where the requirement came from, so the student can contest it. */
  sourceRef: z.string().nullable(),
  /** What the student can do about a `missing_data` row. */
  remedy: z.string().nullable(),
});

export type EligibilityCheck = z.infer<typeof EligibilityCheckSchema>;

export const ELIGIBILITY_VERDICTS = [
  'eligible',
  'not_eligible',
  'incomplete',
  'not_assessable',
] as const;
export type EligibilityVerdict = (typeof ELIGIBILITY_VERDICTS)[number];

export const EligibilityExplanationSchema = z.object({
  programId: z.string(),
  intakeId: z.string().nullable(),
  verdict: z.enum(ELIGIBILITY_VERDICTS),
  checks: z.array(EligibilityCheckSchema),
  evaluatedAt: z.iso.datetime(),
  /** Catalogue version the verdict was computed against — verdicts are dated. */
  catalogueVersion: z.string().nullable(),
});

export type EligibilityExplanation = z.infer<typeof EligibilityExplanationSchema>;

/**
 * Roll checks up to a verdict. Any `fail` is decisive; otherwise missing data
 * keeps the verdict `incomplete` rather than letting an absence read as a pass.
 */
export function rollUpVerdict(checks: readonly EligibilityCheck[]): EligibilityVerdict {
  if (checks.length === 0) return 'not_assessable';
  if (checks.some((c) => c.outcome === 'fail')) return 'not_eligible';
  if (checks.some((c) => c.outcome === 'missing_data')) return 'incomplete';
  if (checks.some((c) => c.outcome === 'unknown')) return 'not_assessable';
  return 'eligible';
}
