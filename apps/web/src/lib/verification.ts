import type { VerificationClaim, VerifiableType } from '@modex/contracts';

/**
 * Builds the claim a `<VerificationBadge>` renders from an API projection.
 *
 * Note the `canDisplay` gate: the API has already decided whether the
 * institution may show a verified badge, and this refuses to upgrade the claim
 * past that decision. A UI that could talk itself into a verified badge would
 * defeat the whole pipeline.
 */
export function institutionClaim(input: {
  id: string;
  displayName: string;
  verificationState: VerificationClaim['state'];
  canDisplayVerifiedBadge: boolean;
  verifiedAt?: string | null;
  expiresAt?: string | null;
}): VerificationClaim {
  return {
    objectType: 'institution',
    objectId: input.id,
    state: input.canDisplayVerifiedBadge ? input.verificationState : downgrade(input.verificationState),
    verifierName: input.canDisplayVerifiedBadge ? 'Modex Trust' : null,
    verifierType: input.canDisplayVerifiedBadge ? 'trust_agent' : null,
    verifiedAt: input.verifiedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    evidenceSummary: input.canDisplayVerifiedBadge
      ? 'Legal entity confirmed, official domain confirmed by DNS record, authorised signatory verified on that domain, and a signed partnership contract on file.'
      : null,
  };
}

export function programmeClaim(input: {
  id: string;
  institutionVerified: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
}): VerificationClaim {
  return {
    objectType: 'program',
    objectId: input.id,
    // A programme is only ever as verified as the institution behind it.
    state: input.institutionVerified && input.verifiedAt !== null ? 'verified' : 'unverified',
    verifierName: input.institutionVerified ? 'The university' : null,
    verifierType: input.institutionVerified ? 'institution' : null,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    evidenceSummary: input.institutionVerified
      ? 'Published by the university from its own catalogue, against a verified partnership.'
      : null,
  };
}

export function emptyClaim(objectType: VerifiableType, objectId: string): VerificationClaim {
  return {
    objectType,
    objectId,
    state: 'unverified',
    verifierName: null,
    verifierType: null,
    verifiedAt: null,
    expiresAt: null,
    evidenceSummary: null,
  };
}

/** Anything short of a full pass reads as pending or worse, never as verified. */
function downgrade(state: VerificationClaim['state']): VerificationClaim['state'] {
  return state === 'verified' ? 'pending' : state;
}
