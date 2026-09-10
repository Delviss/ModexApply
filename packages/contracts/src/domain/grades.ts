import { z } from 'zod';

/**
 * Grade conversion between systems is **explicit, sourced and shown to the
 * student** (Phase 2 §4). A platform that quietly maps a 3.2/4.0 onto a UK 2:1
 * and then says "not eligible" has made an unappealable decision out of an
 * arithmetic choice nobody can see.
 *
 * So every conversion carries the table it came from and a sentence the student
 * reads. Where no published table exists, the conversion refuses rather than
 * interpolating — `convertGrade` returns `null` and the eligibility engine turns
 * that into `unknown`, never into `fail`.
 */
export const GRADE_SCALES = ['gpa_4', 'gpa_5', 'percentage', 'uk_class', 'ects_grade'] as const;
export type GradeScale = (typeof GRADE_SCALES)[number];

export const GradeSchema = z.object({
  scale: z.enum(GRADE_SCALES),
  /**
   * Numeric position on the scale. `uk_class` uses 1 = First, 2.1 = Upper
   * second, 2.2 = Lower second, 3 = Third — the ordering is deliberately
   * *descending in quality* on that one scale, which is exactly the trap a
   * naive `>=` comparison falls into. `compareOnScale` handles it.
   */
  value: z.number(),
});

export type Grade = z.infer<typeof GradeSchema>;

/**
 * True when a higher number means a better result.
 *
 * `uk_class` is the exception: a First is 1 and a Third is 3, so a threshold of
 * "at least a 2:1" is `value <= 2.1`, not `>=`.
 */
export function isAscendingScale(scale: GradeScale): boolean {
  return scale !== 'uk_class';
}

/**
 * Compares a student's grade against a threshold **on the same scale**, in the
 * direction that scale actually runs.
 */
export function meetsThreshold(
  studentValue: number,
  comparison: 'gte' | 'gt' | 'lte' | 'lt' | 'eq',
  threshold: number,
  scale: GradeScale,
): boolean {
  // On a descending scale, "at least a 2:1" is numerically "<= 2.1". Flipping
  // the operator here rather than at the call site means a rule authored as
  // `gte 2.1` on `uk_class` — which is how a registrar would phrase it — still
  // means what they meant.
  const flip = !isAscendingScale(scale);
  const effective = flip
    ? ({ gte: 'lte', gt: 'lt', lte: 'gte', lt: 'gt', eq: 'eq' } as const)[comparison]
    : comparison;

  switch (effective) {
    case 'gte':
      return studentValue >= threshold;
    case 'gt':
      return studentValue > threshold;
    case 'lte':
      return studentValue <= threshold;
    case 'lt':
      return studentValue < threshold;
    case 'eq':
      return studentValue === threshold;
  }
}

export interface GradeConversion {
  value: number;
  scale: GradeScale;
  /** The published table this mapping came from. Rendered to the student. */
  sourceRef: string;
  /** The sentence shown next to the converted figure. */
  note: string;
}

interface ConversionBand {
  /** Inclusive lower bound on the source scale, in ascending-quality order. */
  from: number;
  to: number;
  value: number;
}

/**
 * Published equivalence bands, source-referenced.
 *
 * Deliberately coarse. These are the bands admissions offices actually publish;
 * inventing decimal precision between them would be making up a number and
 * dressing it as a conversion.
 */
const CONVERSION_TABLES: Readonly<
  Record<string, { sourceRef: string; label: string; bands: readonly ConversionBand[] }>
> = Object.freeze({
  'gpa_4:percentage': {
    sourceRef: 'https://www.wes.org/gpa-calculator/',
    label: 'WES 4.0 grade-point to percentage bands',
    bands: [
      { from: 3.7, to: 4.0, value: 90 },
      { from: 3.3, to: 3.7, value: 85 },
      { from: 3.0, to: 3.3, value: 80 },
      { from: 2.7, to: 3.0, value: 75 },
      { from: 2.3, to: 2.7, value: 70 },
      { from: 2.0, to: 2.3, value: 65 },
      { from: 1.0, to: 2.0, value: 55 },
      { from: 0, to: 1.0, value: 40 },
    ],
  },
  'gpa_4:uk_class': {
    sourceRef: 'https://www.ukcisa.org.uk/',
    label: 'UK degree classification equivalence for a US 4.0 grade-point average',
    bands: [
      { from: 3.7, to: 4.0, value: 1 },
      { from: 3.3, to: 3.7, value: 2.1 },
      { from: 3.0, to: 3.3, value: 2.1 },
      { from: 2.7, to: 3.0, value: 2.2 },
      { from: 2.3, to: 2.7, value: 2.2 },
      { from: 2.0, to: 2.3, value: 3 },
      { from: 0, to: 2.0, value: 3 },
    ],
  },
  'gpa_5:gpa_4': {
    sourceRef: 'https://www.wes.org/gpa-calculator/',
    label: 'Five-point to four-point grade-point average',
    bands: [
      { from: 4.5, to: 5.0, value: 4.0 },
      { from: 4.0, to: 4.5, value: 3.7 },
      { from: 3.5, to: 4.0, value: 3.3 },
      { from: 3.0, to: 3.5, value: 3.0 },
      { from: 2.5, to: 3.0, value: 2.7 },
      { from: 2.0, to: 2.5, value: 2.3 },
      { from: 0, to: 2.0, value: 1.5 },
    ],
  },
  'percentage:uk_class': {
    sourceRef: 'https://www.ukcisa.org.uk/',
    label: 'UK degree classification percentage bands',
    bands: [
      { from: 70, to: 101, value: 1 },
      { from: 60, to: 70, value: 2.1 },
      { from: 50, to: 60, value: 2.2 },
      { from: 40, to: 50, value: 3 },
      { from: 0, to: 40, value: 4 },
    ],
  },
  'ects_grade:percentage': {
    sourceRef: 'https://education.ec.europa.eu/education-levels/higher-education/inclusive-and-connected-higher-education/european-credit-transfer-and-accumulation-system',
    label: 'ECTS grading table',
    bands: [
      { from: 4.5, to: 5.0, value: 90 },
      { from: 4.0, to: 4.5, value: 80 },
      { from: 3.5, to: 4.0, value: 70 },
      { from: 3.0, to: 3.5, value: 60 },
      { from: 2.0, to: 3.0, value: 50 },
      { from: 0, to: 2.0, value: 35 },
    ],
  },
});

/**
 * Converts a grade onto the scale a requirement is written in.
 *
 * Returns `null` when no published table covers the pair — the caller must then
 * report `unknown`, not guess. Two things this deliberately does not do:
 * interpolate inside a band, and chain two tables together to reach a third
 * scale. Both would manufacture precision the sources do not have.
 */
export function convertGrade(grade: Grade, to: GradeScale): GradeConversion | null {
  if (grade.scale === to) {
    return {
      value: grade.value,
      scale: to,
      sourceRef: 'no conversion required',
      note: 'Your grade is already on the scale this requirement uses.',
    };
  }

  const table = CONVERSION_TABLES[`${grade.scale}:${to}`];
  if (table === undefined) return null;

  const band = table.bands.find((b) => grade.value >= b.from && grade.value < b.to);
  // The top band is half-open above, so a perfect score falls off the end.
  const matched = band ?? table.bands.find((b) => grade.value === b.to) ?? null;
  if (matched === null) return null;

  return {
    value: matched.value,
    scale: to,
    sourceRef: table.sourceRef,
    note:
      `${formatGrade(grade)} converts to ${formatGrade({ scale: to, value: matched.value })} ` +
      `using ${table.label}. Conversions are approximate; the university makes the final judgement.`,
  };
}

const UK_CLASS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '1': 'a First',
  '2.1': 'an Upper second (2:1)',
  '2.2': 'a Lower second (2:2)',
  '3': 'a Third',
  '4': 'below a Third',
});

/** The grade as a student would say it, for `studentValue` and conversion notes. */
export function formatGrade(grade: Grade): string {
  switch (grade.scale) {
    case 'uk_class':
      return UK_CLASS_LABELS[String(grade.value)] ?? `a UK classification of ${grade.value}`;
    case 'percentage':
      return `${grade.value}%`;
    case 'gpa_4':
      return `a GPA of ${grade.value} out of 4.0`;
    case 'gpa_5':
      return `a GPA of ${grade.value} out of 5.0`;
    case 'ects_grade':
      return `an ECTS grade of ${grade.value}`;
  }
}
