import { z } from 'zod';

/**
 * "Every trust claim has evidence, an owner and a validity period" (epic §2.4).
 * This module is that sentence as a type. Nothing renders a verified badge
 * without a `VerificationClaim`, and the badge component takes the claim, not a
 * boolean.
 */
export const VERIFICATION_STATES = ['unverified', 'pending', 'verified', 'expired', 'revoked'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const VERIFIABLE_TYPES = [
  'institution',
  'program',
  'offer',
  'guide',
  'review',
  'document',
] as const;
export type VerifiableType = (typeof VERIFIABLE_TYPES)[number];

export const VerificationClaimSchema = z.object({
  objectType: z.enum(VERIFIABLE_TYPES),
  objectId: z.string(),
  state: z.enum(VERIFICATION_STATES),
  /** Who stands behind the claim — a trust agent, a connector, the institution. */
  verifierName: z.string().nullable(),
  verifierType: z.enum(['trust_agent', 'institution', 'automated_check', 'third_party']).nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /**
   * A short, public-safe description of *what* was checked. The evidence itself
   * (contracts, ID scans, DNS challenge records) is stored separately and is
   * never exposed publicly — Phase 1 §2.
   */
  evidenceSummary: z.string().nullable(),
});

export type VerificationClaim = z.infer<typeof VerificationClaimSchema>;

/**
 * The state a claim *actually* has right now, which is not always the stored one:
 * a verified claim past its expiry is expired, whatever the column says. Read
 * paths call this so an expired badge can never be served as current.
 */
export function effectiveVerificationState(
  claim: Pick<VerificationClaim, 'state' | 'expiresAt'>,
  now: Date = new Date(),
): VerificationState {
  if (claim.state === 'verified' && claim.expiresAt !== null && new Date(claim.expiresAt) <= now) {
    return 'expired';
  }
  return claim.state;
}

/** There is no partial badge (Phase 1 §2) — only a fully verified claim shows one. */
export function canDisplayVerifiedBadge(
  claim: Pick<VerificationClaim, 'state' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  return effectiveVerificationState(claim, now) === 'verified';
}

/**
 * The institution verification pipeline (Phase 1 §2). Order is fixed and the
 * only legal path is forward one stage at a time, or out to `failed`/`revoked`.
 */
export const VERIFICATION_STAGES = [
  'legal_entity_check',
  'official_domain_confirmation',
  'partner_contact_confirmation',
  'signed_contract',
  'active',
] as const;

export type VerificationStage = (typeof VERIFICATION_STAGES)[number];

export const STAGE_LABELS: Readonly<Record<VerificationStage, string>> = Object.freeze({
  legal_entity_check: 'Legal entity check',
  official_domain_confirmation: 'Official domain confirmation',
  partner_contact_confirmation: 'Partner contact confirmation',
  signed_contract: 'Signed contract',
  active: 'Active partnership',
});

export const STAGE_STATUSES = ['pending', 'active', 'done', 'error'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
