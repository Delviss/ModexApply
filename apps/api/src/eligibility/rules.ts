import {
  convertGrade,
  formatGrade,
  highestQualification,
  isTestCurrent,
  meetsThreshold,
  RuleJsonSchema,
  type EligibilityCheck,
  type Grade,
  type RuleJson,
  type RuleType,
  type StudentProfile,
} from '@modex/contracts';

/**
 * The rule evaluators (Phase 2 §4, FR-005).
 *
 * Pure functions: a requirement, a profile and some context in, one
 * `EligibilityCheck` out. No Prisma, no clock of their own, no I/O — so the
 * awkward cases are unit tests rather than integration tests, and there is
 * nowhere for a network failure to turn into a `fail`.
 *
 * Three invariants hold across all of them, and each has a test:
 *
 *  1. **An absence is never a rejection.** Missing profile data yields
 *     `missing_data` with a remedy naming the exact next action. A student who
 *     has not uploaded a transcript is unassessed, not ineligible.
 *  2. **An unparseable rule is never a pass.** It yields `unknown`. The engine
 *     refuses to evaluate a rule it cannot read rather than guessing either way.
 *  3. **Nothing throws.** A throw in one evaluator would take down the whole
 *     explanation, and a student would see nothing instead of eight rows and
 *     one gap.
 */

export interface EvaluationContext {
  now: Date;
  /**
   * Document types the student holds in a state a connector would accept —
   * `isConnectorEligible` is true. A quarantined transcript is deliberately
   * absent from this set, which makes it missing data rather than a pass.
   */
  usableDocumentTypes: ReadonlySet<string>;
  /** Document types present but not yet usable, so the remedy can say why. */
  blockedDocumentTypes: ReadonlyMap<string, string>;
}

interface RequirementInput {
  id: string;
  ruleType: RuleType;
  ruleJson: unknown;
  humanSummary: string;
  sourceRef: string | null;
}

/** Rules that can be answered without a profile at all. */
const PROFILE_INDEPENDENT_RULES: ReadonlySet<string> = new Set([
  'document_required',
  'portfolio',
  'interview',
]);

/** Shorthand so every evaluator returns the same shape without ceremony. */
function check(
  requirement: RequirementInput,
  fields: Pick<EligibilityCheck, 'outcome' | 'reason'> &
    Partial<Pick<EligibilityCheck, 'studentValue' | 'remedy'>>,
): EligibilityCheck {
  return {
    requirementId: requirement.id,
    ruleType: requirement.ruleType,
    requirement: requirement.humanSummary,
    sourceRef: requirement.sourceRef,
    studentValue: fields.studentValue ?? null,
    remedy: fields.remedy ?? null,
    outcome: fields.outcome,
    reason: fields.reason,
  };
}

/**
 * Evaluates one requirement.
 *
 * The parse happens here rather than in each evaluator so that "unparseable
 * means unknown" is one decision in one place, and cannot be forgotten in the
 * ninth rule type somebody adds later.
 */
export function evaluateRequirement(
  requirement: RequirementInput,
  profile: StudentProfile | null,
  context: EvaluationContext,
): EligibilityCheck {
  const parsed = RuleJsonSchema.safeParse(requirement.ruleJson);
  if (!parsed.success) {
    return check(requirement, {
      outcome: 'unknown',
      reason:
        'We could not read this requirement in a form we can check automatically, so we have not judged it either way. Ask the university or a student guide.',
      remedy: null,
    });
  }

  const rule = parsed.data;
  if (rule.ruleType !== requirement.ruleType) {
    return check(requirement, {
      outcome: 'unknown',
      reason:
        'This requirement is recorded inconsistently in the catalogue, so we have not judged it. We have asked the university to confirm it.',
    });
  }

  // Not every rule needs a profile. A document requirement reads the vault, and
  // a portfolio or interview is the university's judgement either way — so a
  // student who has uploaded a transcript but not filled in their nationality
  // still gets a real answer on the transcript. Short-circuiting all nine on a
  // missing profile would report "we need your profile" for a requirement the
  // profile has nothing to do with.
  if (profile === null && !PROFILE_INDEPENDENT_RULES.has(rule.ruleType)) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'We need your profile before we can check this requirement.',
      remedy: 'Complete your profile to see whether you meet this requirement.',
    });
  }

  try {
    return evaluateParsed(rule, requirement, profile, context);
  } catch {
    // An evaluator that throws must not take the whole explanation with it: a
    // student seeing nothing is strictly worse than a student seeing eight rows
    // and one honest gap.
    return check(requirement, {
      outcome: 'unknown',
      reason: 'We could not finish checking this requirement. It has not counted against you.',
    });
  }
}

function evaluateParsed(
  rule: RuleJson,
  requirement: RequirementInput,
  profile: StudentProfile | null,
  context: EvaluationContext,
): EligibilityCheck {
  // The three profile-independent arms are handled first, so the cast below is
  // sound: everything after this point needed a profile and therefore has one.
  switch (rule.ruleType) {
    case 'document_required':
      return documentRequired(rule, requirement, context);
    case 'portfolio':
      return check(requirement, {
        outcome: 'unknown',
        reason: `This programme asks for a portfolio in ${rule.format} form. A portfolio is judged by the university, not by us.`,
        remedy: 'Prepare your portfolio before you apply.',
      });
    case 'interview':
      return check(requirement, {
        outcome: 'unknown',
        reason:
          rule.mode === 'either'
            ? 'This programme includes an interview. The university decides the outcome, not us.'
            : `This programme includes an ${rule.mode.replace('_', ' ')} interview. The university decides the outcome, not us.`,
      });
    default:
      break;
  }

  const held = profile as StudentProfile;
  switch (rule.ruleType) {
    case 'academic_qualification':
      return academicQualification(rule, requirement, held);
    case 'gpa_minimum':
      return gpaMinimum(rule, requirement, held);
    case 'english_language':
      return englishLanguage(rule, requirement, held, context);
    case 'work_experience':
      return workExperience(rule, requirement, held);
    case 'age_minimum':
      return ageMinimum(rule, requirement, held, context);
    case 'nationality_restriction':
      return nationalityRestriction(rule, requirement, held);
    default:
      // Unreachable: the profile-independent arms returned above.
      return check(requirement, {
        outcome: 'unknown',
        reason: 'We could not check this requirement.',
      });
  }
}

const QUALIFICATION_RANK: Readonly<Record<string, number>> = Object.freeze({
  high_school: 1,
  diploma: 2,
  bachelors: 3,
  masters: 4,
  doctorate: 5,
});

function academicQualification(
  rule: Extract<RuleJson, { ruleType: 'academic_qualification' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
): EligibilityCheck {
  const held = highestQualification(profile);
  if (held === null) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'You have not added a qualification yet, so we cannot check this.',
      remedy: 'Add your most recent qualification to your profile.',
    });
  }

  const required = QUALIFICATION_RANK[rule.level];
  const heldRank = QUALIFICATION_RANK[held.level];
  const studentValue = `a ${held.level.replace('_', ' ')} from ${held.institutionName}`;

  if (required === undefined || heldRank === undefined) {
    return check(requirement, {
      outcome: 'unknown',
      reason: `We do not have a comparison for the "${rule.level}" qualification level, so we have not judged this.`,
      studentValue,
    });
  }

  if (heldRank < required) {
    return check(requirement, {
      outcome: 'fail',
      reason: `This programme requires a ${rule.level.replace('_', ' ')}, and your highest qualification is a ${held.level.replace('_', ' ')}.`,
      studentValue,
    });
  }

  if (rule.countries.length > 0 && !rule.countries.includes(held.countryCode)) {
    return check(requirement, {
      outcome: 'unknown',
      reason: `This programme names specific awarding countries (${rule.countries.join(', ')}) and yours is ${held.countryCode}. The university decides whether your qualification is recognised.`,
      studentValue,
      remedy: 'Ask the university whether your qualification is recognised.',
    });
  }

  // An unfinished degree is not a missing one, and it is not a fail either --
  // conditional offers on a pending final year are ordinary.
  if (held.completedAt === null) {
    return check(requirement, {
      outcome: 'pass',
      reason: 'Your qualification meets the required level. It is still in progress, so any offer is likely to be conditional on completing it.',
      studentValue: `${studentValue} (in progress)`,
    });
  }

  return check(requirement, {
    outcome: 'pass',
    reason: 'Your highest qualification meets the required level.',
    studentValue,
  });
}

function gpaMinimum(
  rule: Extract<RuleJson, { ruleType: 'gpa_minimum' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
): EligibilityCheck {
  const held = highestQualification(profile);
  const grade: Grade | null = held?.grade ?? null;
  if (grade === null) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'You have not added a grade for your qualification, so we cannot check this.',
      remedy: 'Add the grade for your most recent qualification.',
    });
  }

  const converted = convertGrade(grade, rule.scale);
  if (converted === null) {
    // Refusing beats interpolating. `unknown` is not `fail`.
    return check(requirement, {
      outcome: 'unknown',
      reason: `This requirement is written on the ${rule.scale} scale and yours is ${grade.scale}. We have no published conversion between the two, so we have not judged it rather than guess.`,
      studentValue: formatGrade(grade),
      remedy: 'Ask the university how your grade converts.',
    });
  }

  if (rule.comparison === 'in' || rule.comparison === 'not_in') {
    // The shared comparison enum carries set operators for other rule types.
    // Against a single grade threshold they mean nothing, and coercing them
    // into an ordering would invent a judgement the requirement did not make.
    return check(requirement, {
      outcome: 'unknown',
      reason:
        'This grade requirement is recorded with a comparison we cannot apply to a single grade, so we have not judged it.',
      studentValue: formatGrade(grade),
    });
  }

  const met = meetsThreshold(converted.value, rule.comparison, rule.value, rule.scale);
  const studentValue =
    grade.scale === rule.scale
      ? formatGrade(grade)
      : `${formatGrade(grade)} — ${converted.note}`;

  return check(requirement, {
    outcome: met ? 'pass' : 'fail',
    reason: met
      ? 'Your grade meets the published minimum.'
      : `Your grade is below the published minimum of ${formatGrade({ scale: rule.scale, value: rule.value })}.`,
    studentValue,
  });
}

function englishLanguage(
  rule: Extract<RuleJson, { ruleType: 'english_language' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
  context: EvaluationContext,
): EligibilityCheck {
  const matching = profile.languageTests.filter((test) => test.test === rule.test);
  if (matching.length === 0) {
    const others = profile.languageTests.map((test) => test.test);
    return check(requirement, {
      outcome: 'missing_data',
      reason:
        others.length === 0
          ? 'You have not added an English language test yet.'
          : `This programme asks for ${rule.test.toUpperCase()}, and you have added ${others.join(', ').toUpperCase()}.`,
      remedy: `Add your ${rule.test.toUpperCase()} result to your profile.`,
    });
  }

  const current = matching.filter((test) => isTestCurrent(test, context.now));
  const [lapsed] = matching;
  if (current.length === 0 && lapsed !== undefined) {
    // An expired test is a specific, fixable thing -- not a failing score.
    return check(requirement, {
      outcome: 'missing_data',
      reason: `Your ${rule.test.toUpperCase()} result has expired. Universities will not accept it.`,
      studentValue: `${rule.test.toUpperCase()} ${lapsed.overall}, expired`,
      remedy: 'Retake the test, or add a more recent result.',
    });
  }

  const [first, ...rest] = current;
  if (first === undefined) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: `You have not added a current ${rule.test.toUpperCase()} result.`,
      remedy: `Add your ${rule.test.toUpperCase()} result to your profile.`,
    });
  }
  const best = rest.reduce((a, b) => (b.overall > a.overall ? b : a), first);
  const studentValue = `${rule.test.toUpperCase()} ${best.overall}${
    Object.keys(best.bands).length > 0
      ? ` (${Object.entries(best.bands)
          .map(([band, score]) => `${band} ${score}`)
          .join(', ')})`
      : ''
  }`;

  if (best.overall < rule.overallMinimum) {
    return check(requirement, {
      outcome: 'fail',
      reason: `Your overall score is below the required ${rule.overallMinimum}.`,
      studentValue,
    });
  }

  // A 6.5 overall with a 5.0 in writing usually still fails, so the per-band
  // floors are checked even when the overall passes.
  const shortBands: string[] = [];
  const unknownBands: string[] = [];
  for (const [band, minimum] of Object.entries(rule.bandMinimums)) {
    const score = best.bands[band];
    if (score === undefined) unknownBands.push(band);
    else if (score < minimum) shortBands.push(`${band} ${score}, needs ${minimum}`);
  }

  if (shortBands.length > 0) {
    return check(requirement, {
      outcome: 'fail',
      reason: `Your overall score is high enough, but a per-section minimum is not met: ${shortBands.join('; ')}.`,
      studentValue,
    });
  }

  if (unknownBands.length > 0) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: `Your overall score meets the minimum, but this programme also sets minimums per section and we do not have your ${unknownBands.join(', ')} score.`,
      studentValue,
      remedy: `Add your ${unknownBands.join(', ')} score to your profile.`,
    });
  }

  return check(requirement, {
    outcome: 'pass',
    reason: 'Your language test meets the overall and per-section minimums.',
    studentValue,
  });
}

function workExperience(
  rule: Extract<RuleJson, { ruleType: 'work_experience' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
): EligibilityCheck {
  if (profile.workExperienceMonths === null) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'You have not told us how much work experience you have.',
      remedy: 'Add your work experience to your profile.',
    });
  }

  const studentValue = `${profile.workExperienceMonths} months`;
  if (profile.workExperienceMonths < rule.months) {
    return check(requirement, {
      outcome: 'fail',
      reason: `This programme requires ${rule.months} months of work experience.`,
      studentValue,
    });
  }

  if (rule.field !== null) {
    // We record duration, not sector. Claiming a pass on relevance we cannot
    // see would be inventing a judgement the university has to make.
    return check(requirement, {
      outcome: 'unknown',
      reason: `You have enough experience by length, but this programme requires it to be in ${rule.field}, and we do not record the field of your experience.`,
      studentValue,
      remedy: `Be ready to show that your experience is in ${rule.field}.`,
    });
  }

  return check(requirement, {
    outcome: 'pass',
    reason: 'You have enough work experience.',
    studentValue,
  });
}

function ageMinimum(
  rule: Extract<RuleJson, { ruleType: 'age_minimum' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
  context: EvaluationContext,
): EligibilityCheck {
  if (profile.dateOfBirth === null) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'You have not added your date of birth.',
      remedy: 'Add your date of birth to your profile.',
    });
  }

  const born = new Date(profile.dateOfBirth);
  let age = context.now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = context.now.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && context.now.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }

  return check(requirement, {
    outcome: age >= rule.years ? 'pass' : 'fail',
    reason:
      age >= rule.years
        ? 'You meet the minimum age for this programme.'
        : `This programme has a minimum age of ${rule.years}.`,
    studentValue: `${age} years old`,
  });
}

function nationalityRestriction(
  rule: Extract<RuleJson, { ruleType: 'nationality_restriction' }>,
  requirement: RequirementInput,
  profile: StudentProfile,
): EligibilityCheck {
  if (profile.nationality === null) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: 'This programme restricts applications by nationality, and you have not added yours.',
      remedy: 'Add your nationality to your profile.',
    });
  }

  const listed = rule.countries.includes(profile.nationality);
  const permitted = rule.comparison === 'in' ? listed : !listed;

  return check(requirement, {
    outcome: permitted ? 'pass' : 'fail',
    reason: permitted
      ? 'This programme is open to applicants of your nationality.'
      : rule.comparison === 'in'
        ? `This programme accepts applications only from nationals of ${rule.countries.join(', ')}.`
        : `This programme does not accept applications from nationals of ${rule.countries.join(', ')}.`,
    studentValue: profile.nationality,
  });
}

function documentRequired(
  rule: Extract<RuleJson, { ruleType: 'document_required' }>,
  requirement: RequirementInput,
  context: EvaluationContext,
): EligibilityCheck {
  if (context.usableDocumentTypes.has(rule.documentType)) {
    return check(requirement, {
      outcome: rule.certified ? 'unknown' : 'pass',
      reason: rule.certified
        ? 'You have uploaded this document. This programme requires a certified copy, and only the university can confirm your copy qualifies.'
        : 'You have this document in your vault.',
      studentValue: 'Uploaded and scanned',
    });
  }

  // A blocked document is missing data, never a pass: the file exists but is
  // not in a state any connector would accept, and saying "you have it" would
  // be false at the exact moment it matters.
  const blocked = context.blockedDocumentTypes.get(rule.documentType);
  if (blocked !== undefined) {
    return check(requirement, {
      outcome: 'missing_data',
      reason: blocked,
      studentValue: 'Uploaded, but not usable yet',
      remedy: 'Open your document vault to fix this file.',
    });
  }

  return check(requirement, {
    outcome: 'missing_data',
    reason: `This programme requires a ${rule.documentType.replace(/_/g, ' ')}, and you have not uploaded one.`,
    remedy: `Upload your ${rule.documentType.replace(/_/g, ' ')} to your document vault.`,
  });
}
