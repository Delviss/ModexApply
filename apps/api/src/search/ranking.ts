import type { ProgramSearchQuery, RankingFactor, StudentProfile } from '@modex/contracts';
import type { SearchDocument } from './search-index.port.js';

/**
 * Deterministic weighted ranking with explainable factors (Phase 2 §3).
 *
 * Two properties this file exists to guarantee, both tested:
 *
 *  1. **Deterministic.** The same query against the same index returns the same
 *     order. No randomness, no recency jitter, no per-session shuffling. A
 *     student comparing two programmes on Tuesday sees on Thursday what they
 *     saw on Tuesday.
 *
 *  2. **Sponsorship cannot buy a rank.** `sponsored` is worth a small, fixed
 *     tie-break and nothing more — it is applied *after* the substantive
 *     factors and is capped below the smallest of them, so it can only order
 *     rows that were already equal on merit. It can never move a programme past
 *     one that matches the student better, and it can never bypass a hard
 *     eligibility rule, because eligibility is a different subsystem entirely
 *     and this file never sees it.
 *
 * Every result carries its full `RankingFactor[]`, so "why is this third?" has
 * an answer that does not require reading this source.
 */

interface Weighted {
  factor: string;
  weight: number;
  score: (document: SearchDocument, query: ProgramSearchQuery, profile: StudentProfile | null) => {
    raw: number;
    explanation: string;
  };
}

/**
 * The sponsorship tie-break, deliberately smaller than any substantive weight
 * below. Changing this to exceed one would be the change that breaks the
 * promise, and `ranking.test.ts` fails if it ever does.
 */
export const SPONSORED_TIEBREAK = 0.001;

const FACTORS: readonly Weighted[] = Object.freeze([
  {
    factor: 'text_match',
    weight: 0.35,
    score: (document, query) => {
      const term = query.q?.trim().toLowerCase();
      if (term === undefined || term.length === 0) {
        return { raw: 0, explanation: 'No search term, so this did not affect the order.' };
      }
      const name = document.name.toLowerCase();
      if (name === term) return { raw: 1, explanation: `The title is exactly “${query.q}”.` };
      if (name.startsWith(term)) return { raw: 0.9, explanation: `The title starts with “${query.q}”.` };
      if (name.includes(term)) return { raw: 0.75, explanation: `The title contains “${query.q}”.` };
      if (document.discipline.toLowerCase().includes(term)) {
        return { raw: 0.5, explanation: `The subject area matches “${query.q}”.` };
      }
      if (document.searchText.toLowerCase().includes(term)) {
        return { raw: 0.25, explanation: `“${query.q}” appears in the programme details.` };
      }
      return { raw: 0, explanation: `“${query.q}” does not appear in this programme.` };
    },
  },
  {
    factor: 'profile_level_match',
    weight: 0.2,
    score: (document, _query, profile) => {
      if (profile?.intendedLevel == null) {
        return { raw: 0, explanation: 'You have not told us what level you want to study at.' };
      }
      return document.level === profile.intendedLevel
        ? { raw: 1, explanation: 'This is at the level you said you want to study at.' }
        : { raw: 0, explanation: 'This is at a different level from the one you chose.' };
    },
  },
  {
    factor: 'profile_field_match',
    weight: 0.15,
    score: (document, _query, profile) => {
      const field = profile?.intendedField?.trim().toLowerCase();
      if (field === undefined || field.length === 0) {
        return { raw: 0, explanation: 'You have not told us which subject you want to study.' };
      }
      const discipline = document.discipline.toLowerCase();
      if (discipline === field) return { raw: 1, explanation: `This is in ${document.discipline}, the subject you chose.` };
      if (discipline.includes(field) || field.includes(discipline)) {
        return { raw: 0.6, explanation: `This is related to ${profile?.intendedField ?? field}.` };
      }
      return { raw: 0, explanation: 'This is in a different subject from the one you chose.' };
    },
  },
  {
    factor: 'within_budget',
    weight: 0.15,
    score: (document, _query, profile) => {
      const budget = profile?.budgetPerYear ?? null;
      if (budget === null || document.tuitionMinor === null) {
        return { raw: 0, explanation: 'We do not have both a budget and a published tuition fee.' };
      }
      if (document.tuitionCurrency !== budget.currency) {
        // Converting currencies to rank would mean picking an exchange rate and
        // presenting the result as a fact. We do not have a sourced rate, so
        // this factor abstains rather than inventing one.
        return {
          raw: 0,
          explanation: `This is priced in ${document.tuitionCurrency} and your budget is in ${budget.currency}, so we did not compare them.`,
        };
      }
      return document.tuitionMinor <= budget.amountMinor
        ? { raw: 1, explanation: 'The tuition fee is within the budget you set.' }
        : { raw: 0, explanation: 'The tuition fee is above the budget you set.' };
    },
  },
  {
    factor: 'institution_verified',
    weight: 0.1,
    score: (document) =>
      document.institutionVerified
        ? { raw: 1, explanation: 'Modex has verified this institution.' }
        : { raw: 0, explanation: 'This institution has not completed verification.' },
  },
  {
    factor: 'data_freshness',
    weight: 0.05,
    score: (document) =>
      document.staleFields.length === 0
        ? { raw: 1, explanation: 'Every published figure is within its freshness window.' }
        : {
            raw: 0,
            explanation: `We are re-confirming ${document.staleFields.join(', ')} with the university.`,
          },
  },
]);

export interface RankedDocument {
  document: SearchDocument;
  score: number;
  factors: RankingFactor[];
}

/**
 * Scores one document. Pure — the same inputs always give the same number.
 */
export function scoreDocument(
  document: SearchDocument,
  query: ProgramSearchQuery,
  profile: StudentProfile | null,
): RankedDocument {
  const factors: RankingFactor[] = [];
  let score = 0;

  for (const weighted of FACTORS) {
    const { raw, explanation } = weighted.score(document, query, profile);
    const contribution = raw * weighted.weight;
    score += contribution;
    factors.push({
      factor: weighted.factor,
      weight: weighted.weight,
      rawScore: raw,
      contribution,
      explanation,
    });
  }

  if (document.sponsored) {
    score += SPONSORED_TIEBREAK;
    factors.push({
      factor: 'sponsored_placement',
      weight: SPONSORED_TIEBREAK,
      rawScore: 1,
      contribution: SPONSORED_TIEBREAK,
      explanation:
        'This institution pays Modex for placement. It breaks a tie between otherwise equally matched programmes and nothing more — it cannot move this programme above a better match, and it never affects whether you are eligible.',
    });
  }

  return { document, score, factors };
}

/**
 * Orders scored documents.
 *
 * The `programKey` tiebreak at the end is what makes the order total: without
 * it, two identically scored rows could come back in whatever order the storage
 * engine felt like, and "deterministic" would be a claim rather than a
 * property.
 */
export function rankDocuments(
  documents: readonly SearchDocument[],
  query: ProgramSearchQuery,
  profile: StudentProfile | null,
): RankedDocument[] {
  const scored = documents.map((document) => scoreDocument(document, query, profile));

  switch (query.sort) {
    case 'tuition_asc':
      return scored.sort(byNullableNumber((r) => r.document.tuitionMinor, 'asc'));
    case 'tuition_desc':
      return scored.sort(byNullableNumber((r) => r.document.tuitionMinor, 'desc'));
    case 'duration_asc':
      return scored.sort(
        (a, b) =>
          a.document.durationMonths - b.document.durationMonths ||
          a.document.programKey.localeCompare(b.document.programKey),
      );
    case 'deadline_asc':
      return scored.sort(
        byNullableNumber((r) => r.document.nextDeadline?.getTime() ?? null, 'asc'),
      );
    case 'relevance':
    default:
      return scored.sort(
        (a, b) => b.score - a.score || a.document.programKey.localeCompare(b.document.programKey),
      );
  }
}

/**
 * A null sorts last in both directions.
 *
 * A programme with no published deadline is not the most urgent one, and a
 * programme with no published fee is not the cheapest. Letting `null` coerce to
 * zero would put exactly those rows at the top of a "cheapest first" list.
 */
function byNullableNumber(
  pick: (ranked: RankedDocument) => number | null,
  direction: 'asc' | 'desc',
): (a: RankedDocument, b: RankedDocument) => number {
  return (a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) {
      return a.document.programKey.localeCompare(b.document.programKey);
    }
    if (left === null) return 1;
    if (right === null) return -1;
    const delta = direction === 'asc' ? left - right : right - left;
    return delta || a.document.programKey.localeCompare(b.document.programKey);
  };
}

/** True when any result was affected by a commercial relationship. */
export function requiresDisclosure(ranked: readonly RankedDocument[]): boolean {
  return ranked.some((entry) => entry.document.sponsored);
}
