import type { BadgeTone } from '@modex/ui';

/**
 * The vocabulary the catalogue speaks, in the words a student reads.
 *
 * Extracted from the programme page because the filter rail, the result card
 * and the compare table all need the same maps, and four copies of
 * "postgraduate_taught → Postgraduate (taught)" is four places for them to
 * drift apart.
 */

export const LEVEL_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  undergraduate: 'Undergraduate',
  postgraduate_taught: 'Postgraduate (taught)',
  postgraduate_research: 'Postgraduate (research)',
  doctorate: 'Doctorate',
  pathway: 'Pathway',
  short_course: 'Short course',
};

export const MODE_LABELS: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  distance: 'Distance',
  hybrid: 'Hybrid',
};

export const RULE_LABELS: Record<string, string> = {
  academic_qualification: 'Academic qualification',
  gpa_minimum: 'Minimum grade',
  english_language: 'English language',
  work_experience: 'Work experience',
  portfolio: 'Portfolio',
  interview: 'Interview',
  age_minimum: 'Minimum age',
  nationality_restriction: 'Nationality restriction',
  document_required: 'Required document',
};

export const INTAKE_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  open: 'Open',
  closing_soon: 'Closing soon',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/**
 * `closing_soon` is a warning, not a brand moment. Brand crimson is reserved
 * for the apply action, and using it to create urgency would be exactly the
 * discount-coupon register this platform avoids.
 */
export const INTAKE_TONES: Record<string, BadgeTone> = {
  scheduled: 'neutral',
  open: 'success',
  closing_soon: 'warning',
  closed: 'neutral',
  cancelled: 'danger',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  transcript: 'Academic transcript',
  degree_certificate: 'Degree certificate',
  language_test: 'Language test result',
  personal_statement: 'Personal statement',
  reference_letter: 'Reference letter',
  cv: 'CV',
  financial_evidence: 'Financial evidence',
  portfolio: 'Portfolio',
  other: 'Other',
};

/** `YYYY-MM` as a person would say it. Intakes are discussed by month. */
export function intakeLabel(key: string): string {
  const [year, month] = key.split('-');
  const monthIndex = Number(month) - 1;
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return names[monthIndex] === undefined ? key : `${names[monthIndex]} ${year}`;
}
