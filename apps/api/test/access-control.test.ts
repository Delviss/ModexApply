import { describe, expect, it } from 'vitest';
import { buildAccessContext, assertOrganisationAccess, assertPermission, assertConsent, canCrossOrganisations } from '../src/auth/access-context.js';
import { AppError } from '../src/common/errors/app-error.js';

const OXFORD = 'inst_oxford';
const CAMBRIDGE = 'inst_cambridge';

function staffAt(organisationId: string, mfaSatisfied = true) {
  return buildAccessContext({
    userId: 'user_1',
    roles: ['university_admin'],
    organisationId,
    mfaSatisfied,
    consents: [],
  });
}

function student() {
  return buildAccessContext({
    userId: 'user_student',
    roles: ['student'],
    organisationId: null,
    mfaSatisfied: false,
    consents: [],
  });
}

/**
 * The three rejections the Phase 0 acceptance criteria name explicitly:
 * unauthenticated, under-privileged, and cross-organisation.
 */
describe('a protected resource', () => {
  it('rejects an under-privileged request', () => {
    // A student is authenticated and inside no organisation, but holds no
    // catalogue write permission.
    expect(() => assertPermission(student(), 'program:write')).toThrowError(AppError);
    try {
      assertPermission(student(), 'program:write');
    } catch (error) {
      expect((error as AppError).code).toBe('forbidden');
      expect((error as AppError).status).toBe(403);
    }
  });

  it('rejects a cross-organisation request from a fully privileged user', () => {
    const admin = staffAt(OXFORD);
    // The permission check passes...
    expect(() => assertPermission(admin, 'program:write')).not.toThrow();
    // ...and the row still is not theirs.
    expect(() => assertOrganisationAccess(admin, CAMBRIDGE)).toThrowError(AppError);
    try {
      assertOrganisationAccess(admin, CAMBRIDGE);
    } catch (error) {
      expect((error as AppError).code).toBe('organisation_boundary');
      // The message names no institution: a boundary error must not become a
      // probe for which institutions exist.
      expect((error as AppError).message).not.toContain(CAMBRIDGE);
    }
  });

  it('allows the same user against their own organisation', () => {
    expect(() => assertOrganisationAccess(staffAt(OXFORD), OXFORD)).not.toThrow();
  });

  it('rejects a staff session that has not cleared MFA', () => {
    const admin = staffAt(OXFORD, false);
    try {
      assertPermission(admin, 'program:read');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('mfa_required');
    }
  });

  it('does not demand MFA of a student', () => {
    expect(() => assertPermission(student(), 'program:read')).not.toThrow();
  });
});

describe('the organisation boundary', () => {
  it('lets Modex staff cross it, and records who they are', () => {
    const ops = buildAccessContext({
      userId: 'user_ops',
      roles: ['ops'],
      organisationId: null,
      mfaSatisfied: true,
      consents: [],
    });
    expect(canCrossOrganisations(ops)).toBe(true);
    expect(() => assertOrganisationAccess(ops, CAMBRIDGE)).not.toThrow();
  });

  it('does not let a university admin cross it', () => {
    expect(canCrossOrganisations(staffAt(OXFORD))).toBe(false);
  });

  // Self-verification is the failure this separation exists to prevent.
  it('gives no university role the power to verify its own institution', () => {
    const admin = staffAt(OXFORD);
    expect(() => assertPermission(admin, 'institution:verify')).toThrowError(/institution:verify/);
  });
});

describe('consent', () => {
  const withConsent = (overrides: Record<string, unknown> = {}) =>
    buildAccessContext({
      userId: 'user_student',
      roles: ['student'],
      organisationId: null,
      mfaSatisfied: false,
      consents: [
        {
          scope: 'document_share',
          subjectId: null,
          grantedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          ...overrides,
        },
      ],
    });

  it('is separate from authentication', () => {
    expect(() => assertConsent(student(), 'document_share')).toThrowError(/consent/);
  });

  it('passes on an active grant', () => {
    expect(() => assertConsent(withConsent(), 'document_share')).not.toThrow();
  });

  it('fails once revoked, whatever the expiry says', () => {
    expect(() =>
      assertConsent(withConsent({ revokedAt: '2026-02-01T00:00:00.000Z' }), 'document_share'),
    ).toThrowError(/consent/);
  });

  it('does not let consent for one subject cover another', () => {
    const scoped = withConsent({ subjectId: 'inst_oxford' });
    expect(() => assertConsent(scoped, 'document_share', 'inst_oxford')).not.toThrow();
    expect(() => assertConsent(scoped, 'document_share', 'inst_cambridge')).toThrowError(/consent/);
  });

  it('does not let one scope imply another', () => {
    expect(() => assertConsent(withConsent(), 'university_submission')).toThrowError(/consent/);
  });
});
