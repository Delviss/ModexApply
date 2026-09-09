import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  isConsentActive,
  permissionsForRoles,
  requiresMfa,
} from '../src/domain/access.js';

describe('access contracts', () => {
  it('makes MFA mandatory for every staff and high-risk role', () => {
    expect(requiresMfa(['student'])).toBe(false);
    expect(requiresMfa(['guide'])).toBe(false);
    expect(requiresMfa(['student', 'university_staff'])).toBe(true);
    expect(requiresMfa(['trust_agent'])).toBe(true);
    expect(requiresMfa(['finance'])).toBe(true);
  });

  // Phase 1 §2: an institution must not be able to verify itself.
  it('never grants institution:verify to a university role', () => {
    expect(ROLE_PERMISSIONS.university_admin).not.toContain('institution:verify');
    expect(ROLE_PERMISSIONS.university_staff).not.toContain('institution:verify');
    expect(ROLE_PERMISSIONS.ops).not.toContain('institution:verify');
    expect(ROLE_PERMISSIONS.trust_agent).toContain('institution:verify');
  });

  it('gives students no write access to the catalogue', () => {
    const student = permissionsForRoles(['student']);
    expect(student.has('program:write')).toBe(false);
    expect(student.has('program:publish')).toBe(false);
    expect(student.has('program:read')).toBe(true);
  });

  it('unions permissions across roles', () => {
    const both = permissionsForRoles(['finance', 'trust_agent']);
    expect(both.has('institution:verify')).toBe(true);
    expect(both.has('offer:read')).toBe(true);
  });

  it('treats revocation as decisive over an unexpired grant', () => {
    const base = {
      scope: 'document_share' as const,
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      subjectId: null,
    };
    expect(isConsentActive({ ...base, revokedAt: null })).toBe(true);
    expect(isConsentActive({ ...base, revokedAt: '2026-02-01T00:00:00.000Z' })).toBe(false);
    expect(
      isConsentActive({ ...base, expiresAt: '2026-02-01T00:00:00.000Z', revokedAt: null }),
    ).toBe(false);
  });
});
