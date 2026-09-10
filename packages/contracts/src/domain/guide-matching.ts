import type { GuideTopic, PublicGuideProfile } from './guides.js';
import { isGuideDiscoverable } from './guides.js';
import type { ProgramLevel } from './catalogue.js';

/**
 * Guide matching (Phase 3 §2, TRD §11).
 *
 * The same two properties the programme ranker guarantees, for the same
 * reasons, and a third that is specific to people:
 *
 *  1. **Deterministic.** Same student, same roster, same order. A student who
 *     found a guide on Tuesday can find them again on Thursday.
 *
 *  2. **Trust score cannot buy a place.** It is a tie-break worth
 *     `TRUST_SCORE_TIEBREAK` and nothing more, applied after every substantive
 *     factor and capped below the smallest of them. It can only order guides
 *     who already matched equally well, and it is never a substitute for
 *     verification — an unverified guide is not in the candidate set at all.
 *
 *  3. **The match reason is the actual arithmetic.** `matchReason` is built
 *     from the factors that actually contributed, so the line the student reads
 *     cannot drift from the ordering they are looking at (Phase 3 acceptance
 *     criterion 7).
 */

export interface GuideMatchCriteria {
  /** **Hard.** A guide only ever speaks for their own university. */
  institutionId: string;
  /** Strong, and only meaningful when the programme is campus-specific. */
  campusId?: string | null;
  campusSpecific?: boolean;
  programKey?: string | null;
  /** Subject area, for when no guide is on the exact programme. */
  discipline?: string | null;
  level?: ProgramLevel | null;
  yearOfStudy?: number | null;
  languages?: string[];
  homeCountry?: string | null;
  topics?: GuideTopic[];
  /**
   * **Hard filter for scheduled sessions only.** Browsing the directory must
   * not hide a guide who is simply busy this week; booking a session must not
   * offer one.
   */
  requiresAvailability?: boolean;
}

/** Availability is passed alongside the profile; it is not part of what a student sees. */
export interface GuideCandidate {
  profile: PublicGuideProfile;
  /** Free slots in the booking window. Empty means nothing to book. */
  openSlots: number;
}

export interface MatchFactor {
  factor: string;
  weight: number;
  rawScore: number;
  contribution: number;
  explanation: string;
}

export interface GuideMatch {
  profile: PublicGuideProfile;
  score: number;
  factors: MatchFactor[];
  /** One sentence, built from the factors that actually contributed. */
  matchReason: string;
}

/**
 * Smaller than the smallest substantive weight below, which is what makes it a
 * tie-break rather than a thumb on the scale. `guide-matching.test.ts` fails if
 * this ever exceeds one of them.
 */
export const TRUST_SCORE_TIEBREAK = 0.001;

interface Weighted {
  factor: string;
  weight: number;
  score: (
    candidate: GuideCandidate,
    criteria: GuideMatchCriteria,
  ) => { raw: number; explanation: string; reason?: string };
}

/**
 * The weights, in the order TRD §11 states them. Strong is 0.2, moderate 0.1,
 * and campus sits between because it only applies to campus-specific programmes.
 */
const FACTORS: readonly Weighted[] = Object.freeze([
  {
    factor: 'topic_expertise',
    weight: 0.25,
    score: (candidate, criteria) => {
      const wanted = criteria.topics ?? [];
      if (wanted.length === 0) {
        return { raw: 0, explanation: 'You have not picked any topics yet.' };
      }
      const shared = wanted.filter((topic) => candidate.profile.topics.includes(topic));
      if (shared.length === 0) {
        return { raw: 0, explanation: 'They have not offered to talk about the topics you picked.' };
      }
      return {
        raw: shared.length / wanted.length,
        explanation: `They answer questions about ${shared.length} of the ${wanted.length} topics you picked.`,
        reason: `answers questions about ${shared.slice(0, 2).join(' and ').replace(/_/g, ' ')}`,
      };
    },
  },
  {
    factor: 'programme_match',
    weight: 0.2,
    score: (candidate, criteria) => {
      if (criteria.programKey != null && candidate.profile.programKey === criteria.programKey) {
        return {
          raw: 1,
          explanation: 'They are on the exact programme you are looking at.',
          reason: `studies ${candidate.profile.programName ?? 'the same programme'}`,
        };
      }
      const discipline = criteria.discipline?.trim().toLowerCase();
      const theirs = candidate.profile.programName?.toLowerCase() ?? '';
      if (discipline !== undefined && discipline.length > 0 && theirs.includes(discipline)) {
        return {
          raw: 0.6,
          explanation: `They study a ${criteria.discipline} programme, though not the same one.`,
          reason: `studies ${criteria.discipline}`,
        };
      }
      return { raw: 0, explanation: 'They are on a different programme.' };
    },
  },
  {
    factor: 'language',
    weight: 0.2,
    score: (candidate, criteria) => {
      const wanted = (criteria.languages ?? []).map((language) => language.toLowerCase());
      if (wanted.length === 0) {
        return { raw: 0, explanation: 'You have not told us which languages you speak.' };
      }
      const theirs = candidate.profile.languages.map((language) => language.toLowerCase());
      const shared = wanted.filter((language) => theirs.includes(language));
      if (shared.length === 0) {
        return { raw: 0, explanation: 'You do not share a language with them.' };
      }
      const spoken = candidate.profile.languages.filter((language) =>
        shared.includes(language.toLowerCase()),
      );
      return {
        raw: 1,
        explanation: `They speak ${spoken.join(', ')}.`,
        reason: `speaks ${spoken.join(' and ')}`,
      };
    },
  },
  {
    factor: 'campus',
    weight: 0.15,
    score: (candidate, criteria) => {
      if (criteria.campusSpecific !== true || criteria.campusId == null) {
        return { raw: 0, explanation: 'This programme is not tied to one campus.' };
      }
      return candidate.profile.campusId === criteria.campusId
        ? {
            raw: 1,
            explanation: `They are at the ${candidate.profile.campusName ?? 'same'} campus.`,
            reason: `is at the ${candidate.profile.campusName ?? 'same'} campus`,
          }
        : { raw: 0, explanation: 'They are at a different campus.' };
    },
  },
  {
    factor: 'journey',
    weight: 0.1,
    score: (candidate, criteria) => {
      if (criteria.homeCountry == null || candidate.profile.homeCountry === null) {
        return { raw: 0, explanation: 'We do not know where you are both from.' };
      }
      return candidate.profile.homeCountry === criteria.homeCountry
        ? {
            raw: 1,
            explanation: 'They made the same move you are making.',
            reason: 'made the same move from your country',
          }
        : { raw: 0, explanation: 'They moved from a different country.' };
    },
  },
  {
    factor: 'level_and_year',
    weight: 0.1,
    score: (candidate, criteria) => {
      if (criteria.level == null) {
        return { raw: 0, explanation: 'You have not told us what level you want to study at.' };
      }
      if (candidate.profile.level !== criteria.level) {
        return { raw: 0, explanation: 'They study at a different level.' };
      }
      // A second-year has lived through the first year; a first-year has not
      // lived through anything yet. Year is worth a little, not a lot.
      const year = candidate.profile.yearOfStudy ?? 1;
      return {
        raw: year >= 2 ? 1 : 0.7,
        explanation:
          year >= 2
            ? `They are in year ${year} of the same level, so they have been through it.`
            : 'They are in their first year at the same level.',
        reason: 'studies at the level you chose',
      };
    },
  },
]);

/** Sum of every substantive weight, so a score can be read as a proportion. */
export const TOTAL_MATCH_WEIGHT = FACTORS.reduce((total, factor) => total + factor.weight, 0);

/**
 * Ranks a roster for one student.
 *
 * The two hard filters run first and are *filters*, not weights: a guide at
 * another university, or one with no free slot when a session is being booked,
 * is not ranked low — they are not a candidate.
 */
export function matchGuides(
  candidates: readonly GuideCandidate[],
  criteria: GuideMatchCriteria,
): GuideMatch[] {
  const eligible = candidates.filter(
    (candidate) =>
      isGuideDiscoverable(candidate.profile.state) &&
      candidate.profile.institutionId === criteria.institutionId &&
      (criteria.requiresAvailability !== true || candidate.openSlots > 0),
  );

  const matches = eligible.map((candidate) => {
    const factors: MatchFactor[] = [];
    const reasons: string[] = [];
    let score = 0;

    for (const weighted of FACTORS) {
      const { raw, explanation, reason } = weighted.score(candidate, criteria);
      const contribution = raw * weighted.weight;
      score += contribution;
      factors.push({
        factor: weighted.factor,
        weight: weighted.weight,
        rawScore: raw,
        contribution,
        explanation,
      });
      if (contribution > 0 && reason !== undefined) reasons.push(reason);
    }

    // The tie-break. Recorded as a factor so a student reading the explanation
    // sees it did almost nothing, rather than wondering whether it did a lot.
    const trustContribution = (candidate.profile.trustScore / 100) * TRUST_SCORE_TIEBREAK;
    score += trustContribution;
    factors.push({
      factor: 'trust_score_tiebreak',
      weight: TRUST_SCORE_TIEBREAK,
      rawScore: candidate.profile.trustScore / 100,
      contribution: trustContribution,
      explanation:
        'Trust score only separates guides who matched you equally well. It is never a substitute for verification — every guide here is verified.',
    });

    return {
      profile: candidate.profile,
      score,
      factors,
      matchReason: buildMatchReason(reasons, candidate.profile),
    };
  });

  // `id` breaks the last tie, so the order is total rather than whatever the
  // storage engine felt like returning.
  return matches.sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id));
}

/**
 * The "match reason" line.
 *
 * Built only from factors that scored, so it can never claim a shared language
 * with a guide who does not speak one. When nothing scored it says so, which is
 * more useful than an invented compliment.
 */
function buildMatchReason(reasons: readonly string[], profile: PublicGuideProfile): string {
  if (reasons.length === 0) {
    return `Studies at ${profile.institutionName}, and nothing else in your profile matched yet.`;
  }
  const listed = reasons.slice(0, 3);
  const sentence =
    listed.length === 1
      ? (listed[0] ?? '')
      : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1] ?? ''}`;
  return `${capitalise(sentence)}.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
