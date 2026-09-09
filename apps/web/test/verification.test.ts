import { describe, expect, it } from 'vitest';
import { effectiveVerificationState } from '@modex/contracts';
import { emptyClaim, institutionClaim, programmeClaim } from '@/lib/verification';
import { toProvenance } from '@/lib/api';

describe('institution claims', () => {
  const base = {
    id: 'inst_1',
    displayName: 'University of Example',
    verificationState: 'verified' as const,
    verifiedAt: '2026-01-15T00:00:00.000Z',
    expiresAt: null,
  };

  it('shows a verified claim only when the API says the badge may be displayed', () => {
    expect(institutionClaim({ ...base, canDisplayVerifiedBadge: true }).state).toBe('verified');
  });

  // The UI must not be able to talk itself into a verified badge: the API owns
  // that decision, and a client-side upgrade would defeat the whole pipeline.
  it('refuses to upgrade past the API decision', () => {
    const claim = institutionClaim({ ...base, canDisplayVerifiedBadge: false });
    expect(claim.state).toBe('pending');
    expect(claim.verifierName).toBeNull();
    expect(claim.evidenceSummary).toBeNull();
  });

  it('leaves a non-verified state alone rather than inventing one', () => {
    expect(
      institutionClaim({ ...base, verificationState: 'revoked', canDisplayVerifiedBadge: false }).state,
    ).toBe('revoked');
  });

  it('names a verifier only when there is one', () => {
    expect(emptyClaim('institution', 'inst_1').verifierName).toBeNull();
    expect(emptyClaim('institution', 'inst_1').state).toBe('unverified');
  });
});

describe('programme claims', () => {
  it('is never more verified than the institution behind it', () => {
    expect(
      programmeClaim({
        id: 'prog_1',
        institutionVerified: false,
        verifiedAt: '2026-01-15T00:00:00.000Z',
        expiresAt: null,
      }).state,
    ).toBe('unverified');
  });

  it('is unverified until the university has published it', () => {
    expect(
      programmeClaim({ id: 'prog_1', institutionVerified: true, verifiedAt: null, expiresAt: null })
        .state,
    ).toBe('unverified');
  });

  it('expires with its claim, whatever the stored state says', () => {
    const claim = programmeClaim({
      id: 'prog_1',
      institutionVerified: true,
      verifiedAt: '2026-01-15T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
    expect(claim.state).toBe('verified');
    expect(effectiveVerificationState(claim, new Date('2026-06-01T00:00:00.000Z'))).toBe('expired');
  });
});

describe('provenance projection', () => {
  it('normalises dates and carries the sync state through', () => {
    expect(
      toProvenance({
        sourceUpdatedAt: new Date('2026-05-20T00:00:00.000Z'),
        verifiedAt: '2026-05-21T00:00:00.000Z',
        expiresAt: null,
        syncState: 'stale',
        sourceRef: 'partner-feed',
        reviewedBy: null,
      }),
    ).toEqual({
      sourceUpdatedAt: '2026-05-20T00:00:00.000Z',
      verifiedAt: '2026-05-21T00:00:00.000Z',
      expiresAt: null,
      syncState: 'stale',
      sourceRef: 'partner-feed',
      reviewedBy: null,
    });
  });
});
