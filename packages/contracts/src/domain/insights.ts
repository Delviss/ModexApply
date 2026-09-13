import type { ApplicationState } from './applications.js';

/**
 * Platform statistics and insights.
 *
 * This file is the arithmetic behind every number an operator is shown, and it
 * lives in the contracts package for the same reason the eligibility rules do:
 * the API computes these for the real database and the public build computes
 * them for the browser's own state, and a figure that is calculated twice is a
 * figure that will eventually be reported two ways.
 *
 * Three rules, all of which are product boundaries rather than preferences:
 *
 * **1. A count of something is never a prediction about somebody.** Nothing
 * here divides offers by applications and calls it a chance of admission. The
 * funnel reports what happened to a cohort; it does not forecast what will
 * happen to the person reading it.
 *
 * **2. A rate with a small denominator is withheld, not rounded.** `rate()`
 * returns `null` below `MIN_COHORT`, and every caller renders that as "too few
 * to report". A conversion rate over four applications is noise presented with
 * a decimal point.
 *
 * **3. Money is never averaged across currencies.** Totals are per-currency
 * and stay in minor units; there is no "total value" figure anywhere that
 * silently adds pounds to euros.
 */

/**
 * Below this many observations a rate is not reported at all.
 *
 * Twenty is not a statistical threshold, it is an editorial one: it is the
 * point at which one more or one fewer event stops moving the headline figure
 * by a visible amount.
 */
export const MIN_COHORT = 20;

export interface Rate {
  /** Fraction in [0,1], or null when the denominator is below `MIN_COHORT`. */
  value: number | null;
  numerator: number;
  denominator: number;
  /** Why a null value is null, in words the console can print unchanged. */
  withheldReason: string | null;
}

export function rate(numerator: number, denominator: number): Rate {
  if (denominator < MIN_COHORT) {
    return {
      value: null,
      numerator,
      denominator,
      withheldReason: `Too few to report — ${denominator} of a minimum ${MIN_COHORT}.`,
    };
  }
  return { value: numerator / denominator, numerator, denominator, withheldReason: null };
}

export function formatRate(value: Rate): string {
  return value.value === null ? '—' : `${(value.value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// The application funnel
// ---------------------------------------------------------------------------

/**
 * The funnel, as the five things that actually happen to an application.
 *
 * Deliberately coarser than `APPLICATION_STATES`. An operator asking "where do
 * applications stop?" is not helped by fourteen buckets, three of which are
 * about retrying a network call, and a chart with a `submitted_pending` column
 * measures our connector rather than the journey.
 */
export const FUNNEL_STAGES = ['started', 'ready', 'submitted', 'decided', 'accepted'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABELS: Readonly<Record<FunnelStage, string>> = Object.freeze({
  started: 'Started',
  ready: 'Marked ready',
  submitted: 'Reached the university',
  decided: 'Decided',
  accepted: 'Offer accepted',
});

/**
 * Which stages a state counts towards.
 *
 * The funnel is cumulative — an accepted application also counts as submitted —
 * because the question is "how far did it get", and a non-cumulative funnel
 * answers "where is it sitting right now", which is the queue, not the funnel.
 *
 * `submitted_pending` counts as *started and ready only*. The payload has left
 * the building but no university has confirmed receiving it, and the whole
 * point of that state existing is that we do not claim a submission we cannot
 * evidence.
 */
const STAGE_MEMBERSHIP: Readonly<Record<ApplicationState, readonly FunnelStage[]>> = Object.freeze({
  draft: ['started'],
  ready: ['started', 'ready'],
  submitted_pending: ['started', 'ready'],
  failed: ['started', 'ready'],
  submitted: ['started', 'ready', 'submitted'],
  under_review: ['started', 'ready', 'submitted'],
  more_info: ['started', 'ready', 'submitted'],
  offer: ['started', 'ready', 'submitted', 'decided'],
  rejected: ['started', 'ready', 'submitted', 'decided'],
  accepted: ['started', 'ready', 'submitted', 'decided', 'accepted'],
  declined: ['started', 'ready', 'submitted', 'decided'],
  enrolled: ['started', 'ready', 'submitted', 'decided', 'accepted'],
  expired: ['started', 'ready', 'submitted', 'decided'],
  withdrawn: ['started'],
});

export interface FunnelRow {
  stage: FunnelStage;
  label: string;
  count: number;
  /** Share of the `started` cohort, withheld under `MIN_COHORT`. */
  ofStarted: Rate;
}

export function buildFunnel(states: readonly ApplicationState[]): FunnelRow[] {
  const counts = new Map<FunnelStage, number>(FUNNEL_STAGES.map((stage) => [stage, 0]));
  for (const state of states) {
    for (const stage of STAGE_MEMBERSHIP[state] ?? []) {
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
  }
  const started = counts.get('started') ?? 0;
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage],
    count: counts.get(stage) ?? 0,
    ofStarted: rate(counts.get(stage) ?? 0, started),
  }));
}

/**
 * Where applications stop, as the largest drop between adjacent stages.
 *
 * Returns `null` when the cohort is too small for the answer to mean anything,
 * rather than confidently naming a stage on the strength of two applications.
 */
export function biggestDropOff(rows: readonly FunnelRow[]): { from: FunnelRow; to: FunnelRow; lost: number } | null {
  const started = rows.find((row) => row.stage === 'started')?.count ?? 0;
  if (started < MIN_COHORT) return null;
  let worst: { from: FunnelRow; to: FunnelRow; lost: number } | null = null;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const from = rows[index];
    const to = rows[index + 1];
    if (from === undefined || to === undefined) continue;
    const lost = from.count - to.count;
    if (worst === null || lost > worst.lost) worst = { from, to, lost };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Distributions and trends
// ---------------------------------------------------------------------------

export interface Slice {
  key: string;
  label: string;
  count: number;
  share: number;
}

/**
 * Counts by key, largest first, with everything past `limit` folded into one
 * "Other" row.
 *
 * The fold is not cosmetic. A per-country table with a long tail of ones is a
 * re-identification surface in a console several roles can open, and "Other: 7"
 * answers the operational question without naming the seven.
 */
export function distribution(
  values: readonly string[],
  options: { limit?: number; labels?: Readonly<Record<string, string>>; otherLabel?: string } = {},
): Slice[] {
  const { limit = 6, labels = {}, otherLabel = 'Other' } = options;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const total = values.length;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);

  const rows = head.map(([key, count]) => ({
    key,
    label: labels[key] ?? key,
    count,
    share: total === 0 ? 0 : count / total,
  }));

  if (tail.length > 0) {
    const count = tail.reduce((sum, [, value]) => sum + value, 0);
    rows.push({ key: '__other__', label: otherLabel, count, share: total === 0 ? 0 : count / total });
  }
  return rows;
}

export interface TrendPoint {
  /** ISO date, `YYYY-MM-DD`, at the start of the bucket. */
  date: string;
  count: number;
}

/**
 * A daily series with the empty days present.
 *
 * Missing days are filled with zeroes rather than skipped: a sparse series
 * drawn as a line silently interpolates across the gap, which turns a weekend
 * with no applications into a gentle slope.
 */
export function dailyTrend(
  timestamps: readonly string[],
  days: number,
  now: Date = new Date(),
): TrendPoint[] {
  const buckets = new Map<string, number>();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(end.getTime() - offset * 86_400_000);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }
  for (const timestamp of timestamps) {
    const key = new Date(timestamp).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/**
 * The change between the first and second half of a series, as a fraction.
 *
 * Null when either half is empty — "up 100%" from a base of zero is not a
 * trend, it is a first event.
 */
export function trendChange(points: readonly TrendPoint[]): number | null {
  if (points.length < 4) return null;
  const middle = Math.floor(points.length / 2);
  const earlier = points.slice(0, middle).reduce((sum, point) => sum + point.count, 0);
  const later = points.slice(middle).reduce((sum, point) => sum + point.count, 0);
  if (earlier === 0) return null;
  return (later - earlier) / earlier;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * The median, and never the mean.
 *
 * One application that sat in a queue over a holiday shifts a mean by days and
 * a median by nothing, and the number is read as "how long does this normally
 * take". `p90` is reported next to it because the median alone hides the tail
 * that generates the complaints.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  if (sorted.length % 2 !== 0) return upper;
  return ((sorted[middle - 1] as number) + upper) / 2;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

export function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

/** A duration in hours, printed the way an operator reads it. */
export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

// ---------------------------------------------------------------------------
// The shape the consoles render
// ---------------------------------------------------------------------------

export interface CurrencyTotal {
  currency: string;
  amountMinor: number;
  count: number;
}

/** Totals per currency. There is deliberately no combined figure. */
export function totalsByCurrency(
  entries: readonly { amountMinor: number; currency: string }[],
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const entry of entries) {
    const found = totals.get(entry.currency) ?? { currency: entry.currency, amountMinor: 0, count: 0 };
    found.amountMinor += entry.amountMinor;
    found.count += 1;
    totals.set(entry.currency, found);
  }
  return [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

export interface HeadlineStat {
  id: string;
  label: string;
  value: string;
  /** The one line under the number. Says what it counts, not how good it is. */
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export interface InsightNote {
  id: string;
  /** What the reader should do about it, or `null` when it is context only. */
  action: string | null;
  text: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

/**
 * Turns figures into the short, plain sentences the console prints.
 *
 * An "insight" here is a statement about the data with a stated threshold
 * behind it — never a generated opinion. Every branch below names the number
 * that triggered it, so an operator can disagree with the threshold rather than
 * having to trust the sentence.
 */
export function buildInsightNotes(input: {
  funnel: readonly FunnelRow[];
  overdueAssessments: number;
  quarantined: number;
  staleMoneyRecords: number;
  openTrustCases: number;
  unverifiedRegisterEntries: number;
  medianReviewHours: number | null;
  slaHours: number;
}): InsightNote[] {
  const notes: InsightNote[] = [];

  const drop = biggestDropOff(input.funnel);
  if (drop !== null && drop.lost > 0) {
    notes.push({
      id: 'funnel-drop',
      tone: 'info',
      action: null,
      text:
        `${drop.lost} application(s) stop between "${drop.from.label}" and "${drop.to.label}" — ` +
        'the largest gap in the funnel.',
    });
  }

  if (input.overdueAssessments > 0) {
    notes.push({
      id: 'assessments-overdue',
      tone: 'warning',
      action: 'Open the document queue',
      text:
        `${input.overdueAssessments} document(s) have been waiting longer than the ${input.slaHours}-hour ` +
        'review commitment made to students.',
    });
  }

  if (input.medianReviewHours !== null && input.medianReviewHours > input.slaHours / 2) {
    notes.push({
      id: 'review-slow',
      tone: 'warning',
      action: null,
      text:
        `Median time to a document decision is ${formatHours(input.medianReviewHours)}, over half the ` +
        `${input.slaHours}-hour commitment.`,
    });
  }

  if (input.quarantined > 0) {
    notes.push({
      id: 'quarantined',
      tone: 'danger',
      action: null,
      text:
        `${input.quarantined} uploaded file(s) are quarantined by the malware scan. Nobody opens these; ` +
        'the student is asked for a clean copy.',
    });
  }

  if (input.staleMoneyRecords > 0) {
    notes.push({
      id: 'money-withheld',
      tone: 'warning',
      action: 'Ask the institution to re-publish',
      text:
        `${input.staleMoneyRecords} programme(s) have a tuition figure past its confirmation window. ` +
        'Students are shown "figure out of date", never the old number.',
    });
  }

  if (input.openTrustCases > 0) {
    notes.push({
      id: 'trust-open',
      tone: 'danger',
      action: 'Open the trust console',
      text: `${input.openTrustCases} trust case(s) are open and waiting on a decision.`,
    });
  }

  if (input.unverifiedRegisterEntries > 0) {
    notes.push({
      id: 'register-pending',
      tone: 'neutral',
      action: 'Open the register',
      text:
        `${input.unverifiedRegisterEntries} universit(ies) are in the register below "Partnership signed". ` +
        'No verified badge is published for any of them.',
    });
  }

  if (notes.length === 0) {
    notes.push({
      id: 'clear',
      tone: 'success',
      action: null,
      text: 'Nothing is overdue, quarantined, withheld or awaiting a trust decision.',
    });
  }

  return notes;
}
