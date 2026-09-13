import { describe, expect, it } from 'vitest';
import {
  biggestDropOff,
  buildFunnel,
  buildInsightNotes,
  dailyTrend,
  distribution,
  formatHours,
  formatRate,
  median,
  MIN_COHORT,
  percentile,
  rate,
  totalsByCurrency,
  trendChange,
} from '../src/domain/insights.js';
import type { ApplicationState } from '../src/domain/applications.js';

function cohort(state: ApplicationState, count: number): ApplicationState[] {
  return Array.from({ length: count }, () => state);
}

describe('rates', () => {
  // The product boundary, expressed as arithmetic: a rate over a handful of
  // applications is noise, and printing it with a decimal point makes it look
  // like a measurement.
  it('withholds a rate below the minimum cohort, with the reason', () => {
    const small = rate(3, MIN_COHORT - 1);
    expect(small.value).toBeNull();
    expect(small.withheldReason).toContain(String(MIN_COHORT));
    expect(formatRate(small)).toBe('—');
  });

  it('reports a rate at the minimum cohort', () => {
    expect(rate(10, MIN_COHORT).value).toBeCloseTo(10 / MIN_COHORT);
  });
});

describe('the funnel', () => {
  it('is cumulative — an accepted application also counts as submitted', () => {
    const rows = buildFunnel(['accepted']);
    expect(rows.map((row) => row.count)).toEqual([1, 1, 1, 1, 1]);
  });

  /**
   * The state exists precisely because a payload that left the building is not
   * a submission anybody confirmed receiving, and the funnel must not claim one.
   */
  it('does not count submitted_pending as having reached a university', () => {
    const rows = buildFunnel(['submitted_pending']);
    expect(rows.find((row) => row.stage === 'submitted')?.count).toBe(0);
    expect(rows.find((row) => row.stage === 'ready')?.count).toBe(1);
  });

  it('counts a withdrawn draft as started and no further', () => {
    const rows = buildFunnel(['withdrawn']);
    expect(rows.map((row) => row.count)).toEqual([1, 0, 0, 0, 0]);
  });

  it('names the largest drop once the cohort is big enough', () => {
    const rows = buildFunnel([...cohort('draft', 30), ...cohort('submitted', 10)]);
    const drop = biggestDropOff(rows);
    expect(drop?.from.stage).toBe('started');
    expect(drop?.to.stage).toBe('ready');
    expect(drop?.lost).toBe(30);
  });

  it('refuses to name a drop on a cohort too small to mean anything', () => {
    expect(biggestDropOff(buildFunnel(['draft', 'submitted']))).toBeNull();
  });
});

describe('distributions', () => {
  it('folds the long tail into one row rather than listing singletons', () => {
    const rows = distribution(['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], { limit: 2 });
    expect(rows.at(-1)?.key).toBe('__other__');
    expect(rows.at(-1)?.count).toBe(5);
  });

  it('labels keys when labels are supplied', () => {
    const rows = distribution(['inst_1'], { labels: { inst_1: 'Example University' } });
    expect(rows[0]?.label).toBe('Example University');
  });
});

describe('trends', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');

  // A sparse series drawn as a line interpolates across the gap, turning a
  // weekend with no applications into a gentle slope.
  it('fills empty days rather than skipping them', () => {
    const points = dailyTrend(['2026-06-10T09:00:00.000Z'], 5, now);
    expect(points).toHaveLength(5);
    expect(points.filter((point) => point.count === 0)).toHaveLength(4);
  });

  it('ignores timestamps outside the window', () => {
    expect(dailyTrend(['2020-01-01T00:00:00.000Z'], 5, now).every((point) => point.count === 0)).toBe(true);
  });

  it('reports no change when the earlier half is empty', () => {
    expect(trendChange(dailyTrend(['2026-06-10T09:00:00.000Z'], 4, now))).toBeNull();
  });
});

describe('durations', () => {
  it('uses the median, which one outlier cannot move', () => {
    expect(median([1, 2, 3, 400])).toBe(2.5);
  });

  it('reports the tail next to it', () => {
    expect(percentile([1, 2, 3, 400], 0.9)).toBe(400);
  });

  it('prints minutes, hours and days the way an operator reads them', () => {
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(6)).toBe('6.0 h');
    expect(formatHours(72)).toBe('3.0 days');
    expect(formatHours(null)).toBe('—');
  });
});

describe('money', () => {
  // There is no combined figure anywhere, and this is the test that keeps it
  // that way: adding pounds to euros is a bug that reads as a feature.
  it('totals per currency and never across them', () => {
    const totals = totalsByCurrency([
      { amountMinor: 100_000, currency: 'GBP' },
      { amountMinor: 50_000, currency: 'EUR' },
      { amountMinor: 25_000, currency: 'GBP' },
    ]);
    expect(totals).toHaveLength(2);
    expect(totals.find((one) => one.currency === 'GBP')?.amountMinor).toBe(125_000);
  });
});

describe('insight notes', () => {
  const base = {
    funnel: buildFunnel(['draft']),
    overdueAssessments: 0,
    quarantined: 0,
    staleMoneyRecords: 0,
    openTrustCases: 0,
    unverifiedRegisterEntries: 0,
    medianReviewHours: null,
    slaHours: 48,
  };

  it('says so plainly when nothing is wrong', () => {
    const notes = buildInsightNotes(base);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.tone).toBe('success');
  });

  it('names the number behind every sentence it prints', () => {
    const notes = buildInsightNotes({ ...base, overdueAssessments: 4, openTrustCases: 2 });
    expect(notes.some((note) => note.text.includes('4'))).toBe(true);
    expect(notes.some((note) => note.text.includes('2'))).toBe(true);
  });

  it('never implies a quarantined file will be opened by somebody', () => {
    const notes = buildInsightNotes({ ...base, quarantined: 1 });
    expect(notes.find((note) => note.id === 'quarantined')?.text).toContain('Nobody opens these');
  });
});
