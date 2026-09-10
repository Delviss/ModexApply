import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProgramSearchQuerySchema } from '@modex/contracts';
import { createHarness, createPrisma, resetDatabase, type Harness } from './harness.js';

/**
 * The p95 budget, as a gate rather than an aspiration.
 *
 * Phase 2 §3 sets **p95 < 500 ms for common catalogue queries at expected MVP
 * load**, and requires the test in CI. This is that test.
 *
 * It writes search documents directly rather than walking the catalogue
 * services: what is under measurement is the query path, and seeding through
 * the verification pipeline two thousand times would measure the seeding.
 */

const CATALOGUE_SIZE = 2_000;
const P95_BUDGET_MS = 500;
const RUNS_PER_QUERY = 20;

let prisma: PrismaClient;
let harness: Harness;

const COUNTRIES = ['GB', 'IE', 'NL', 'DE', 'AU'];
const LEVELS = ['undergraduate', 'postgraduate_taught', 'postgraduate_research', 'doctorate'];
const FIELDS = ['Computing', 'Data Science', 'Mechanical Engineering', 'Law', 'Nursing', 'Economics'];
const CITIES = ['Manchester', 'Leeds', 'Dublin', 'Amsterdam', 'Berlin', 'Melbourne'];

beforeAll(async () => {
  prisma = createPrisma();
  await prisma.$connect();
  harness = createHarness(prisma);
  await resetDatabase(prisma);

  const rows = Array.from({ length: CATALOGUE_SIZE }, (_, index) => {
    const country = COUNTRIES[index % COUNTRIES.length];
    const level = LEVELS[index % LEVELS.length];
    const field = FIELDS[index % FIELDS.length];
    const city = CITIES[index % CITIES.length];
    const name = `${level === 'undergraduate' ? 'BSc' : 'MSc'} ${field} ${index}`;
    const institutionName = `University of ${city} ${index % 60}`;

    return {
      programKey: `perf-${index}`,
      programId: `p_${index}`,
      version: 1,
      name,
      description: `A ${field} programme taught in ${city}.`,
      level: level as never,
      discipline: field,
      language: 'English',
      institutionId: `inst_${index % 60}`,
      institutionName,
      institutionVerified: index % 3 !== 0,
      country,
      city,
      durationMonths: 12 + (index % 4) * 6,
      tuitionMinor: 1_000_000 + (index % 40) * 100_000,
      tuitionCurrency: 'GBP',
      applicationFeeMinor: (index % 5) * 2_500,
      intakes: [`2027-0${(index % 9) + 1}`],
      nextDeadline: new Date(2027, index % 12, 1),
      scholarshipAvailable: index % 4 === 0,
      discountAvailable: index % 7 === 0,
      sponsored: index % 50 === 0,
      visible: true,
      staleFields: [],
      syncState: 'synced' as never,
      searchText: `${name} ${field} ${institutionName} ${city} ${country}`,
    };
  });

  await prisma.programSearchDocument.createMany({ data: rows });
  // ANALYZE so the planner has statistics; without it the first queries measure
  // a cold planner rather than the index.
  await prisma.$executeRawUnsafe('ANALYZE program_search_documents;');
}, 180_000);

afterAll(async () => {
  await resetDatabase(prisma);
  await prisma.$disconnect();
});

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function measure(label: string, raw: Record<string, unknown>): Promise<number> {
  const query = ProgramSearchQuerySchema.parse(raw);
  const samples: number[] = [];

  // One warm-up that is not measured: the first query of a shape pays for plan
  // caching and connection warm-up, neither of which a student pays for in a
  // running system.
  await harness.search.search(query, null);

  for (let run = 0; run < RUNS_PER_QUERY; run += 1) {
    const startedAt = performance.now();
    await harness.search.search(query, null);
    samples.push(performance.now() - startedAt);
  }

  const p95 = percentile(samples, 95);
  // Printed so a regression shows a number in the CI log, not just a red cross:
  // "p95 480ms" a week before it breaches is the warning nobody gets from a
  // pass/fail alone.
  // eslint-disable-next-line no-console -- the measurement is the deliverable
  console.log(
    `${label}: p50 ${percentile(samples, 50).toFixed(0)}ms - p95 ${p95.toFixed(0)}ms - budget ${P95_BUDGET_MS}ms`,
  );
  return p95;
}

describe(`search latency over ${CATALOGUE_SIZE} programmes`, () => {
  it('seeded the catalogue it claims to measure', async () => {
    expect(await prisma.programSearchDocument.count()).toBe(CATALOGUE_SIZE);
  });

  it('meets p95 < 500ms on an unfiltered browse', async () => {
    expect(await measure('browse', {})).toBeLessThan(P95_BUDGET_MS);
  });

  it('meets p95 < 500ms on a free-text search', async () => {
    expect(await measure('free text', { q: 'data science' })).toBeLessThan(P95_BUDGET_MS);
  });

  it('meets p95 < 500ms on a faceted search', async () => {
    expect(
      await measure('faceted', {
        country: ['GB'],
        level: ['postgraduate_taught'],
        tuitionMaxMinor: 3_000_000,
      }),
    ).toBeLessThan(P95_BUDGET_MS);
  });

  it('meets p95 < 500ms on a sorted search', async () => {
    expect(await measure('sorted', { sort: 'tuition_asc' })).toBeLessThan(P95_BUDGET_MS);
  });

  // The zero-result path runs one extra count per active filter to build the
  // relaxation suggestions, so it is the most expensive shape and gets its own
  // measurement rather than being assumed cheap.
  it('meets p95 < 500ms on a zero-result search, diagnosis included', async () => {
    expect(
      await measure('zero results', {
        q: 'basket weaving',
        country: ['GB'],
        level: ['doctorate'],
        durationMaxMonths: 6,
      }),
    ).toBeLessThan(P95_BUDGET_MS);
  });
});
