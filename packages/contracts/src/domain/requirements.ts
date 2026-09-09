import { z } from 'zod';

/**
 * A requirement is a **machine-readable rule plus a human-readable summary** —
 * both mandatory (Phase 1 §3). CI fails on a record missing either, and the
 * eligibility engine refuses to evaluate a rule it cannot parse rather than
 * guessing a pass.
 */
export const RULE_TYPES = [
  'academic_qualification',
  'gpa_minimum',
  'english_language',
  'work_experience',
  'portfolio',
  'interview',
  'age_minimum',
  'nationality_restriction',
  'document_required',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

const ComparisonSchema = z.enum(['gte', 'gt', 'lte', 'lt', 'eq', 'in', 'not_in']);

/**
 * Rule payloads are a discriminated union rather than free JSON so that an
 * unparseable rule is a load-time failure, not a silent "eligible".
 */
export const RuleJsonSchema = z.discriminatedUnion('ruleType', [
  z.object({
    ruleType: z.literal('academic_qualification'),
    /** e.g. `bachelors`, `high_school`, `masters`. */
    level: z.string(),
    /** Recognised awarding countries, empty means any. */
    countries: z.array(z.string()).default([]),
  }),
  z.object({
    ruleType: z.literal('gpa_minimum'),
    scale: z.enum(['gpa_4', 'gpa_5', 'percentage', 'uk_class', 'ects_grade']),
    comparison: ComparisonSchema,
    value: z.number(),
  }),
  z.object({
    ruleType: z.literal('english_language'),
    test: z.enum(['ielts', 'toefl_ibt', 'pte', 'duolingo', 'cambridge', 'moi_waiver']),
    overallMinimum: z.number(),
    /** Per-band floors: a 6.5 overall with a 5.0 in writing usually still fails. */
    bandMinimums: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    ruleType: z.literal('work_experience'),
    months: z.number().int().min(0),
    field: z.string().nullable().default(null),
  }),
  z.object({ ruleType: z.literal('portfolio'), format: z.string() }),
  z.object({ ruleType: z.literal('interview'), mode: z.enum(['online', 'in_person', 'either']) }),
  z.object({ ruleType: z.literal('age_minimum'), years: z.number().int().min(0) }),
  z.object({
    ruleType: z.literal('nationality_restriction'),
    comparison: z.enum(['in', 'not_in']),
    countries: z.array(z.string()).min(1),
  }),
  z.object({
    ruleType: z.literal('document_required'),
    documentType: z.string(),
    certified: z.boolean().default(false),
  }),
]);

export type RuleJson = z.infer<typeof RuleJsonSchema>;

export const RequirementSchema = z.object({
  id: z.string(),
  programId: z.string(),
  intakeId: z.string().nullable(),
  ruleType: z.enum(RULE_TYPES),
  ruleJson: RuleJsonSchema,
  /**
   * The sentence a student actually reads. Mandatory — a rule with no summary is
   * a rule nobody can contest, and this platform's whole premise is contestable
   * decisions.
   */
  humanSummary: z.string().min(10, 'Every requirement needs a human-readable summary'),
  sourceRef: z.string().min(1, 'Every requirement must cite where it came from'),
  version: z.number().int().min(1),
});

export type Requirement = z.infer<typeof RequirementSchema>;

/** Used by both the API validator and the CI catalogue check. */
export function validateRequirement(input: unknown): {
  ok: boolean;
  errors: string[];
} {
  const parsed = RequirementSchema.safeParse(input);
  if (parsed.success) {
    if (parsed.data.ruleJson.ruleType !== parsed.data.ruleType) {
      return {
        ok: false,
        errors: [
          `ruleType "${parsed.data.ruleType}" does not match ruleJson.ruleType ` +
            `"${parsed.data.ruleJson.ruleType}"`,
        ],
      };
    }
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}
