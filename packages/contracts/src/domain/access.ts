import { z } from 'zod';

/**
 * Authorization is RBAC **+** organisation boundary **+** resource permission
 * **+** consent scope (Phase 0 §3.2). All four are checked server-side; a role
 * alone never grants access to a row.
 */
export const ROLES = [
  'student',
  'guide',
  'university_admin',
  'university_staff',
  'trust_agent',
  'ops',
  'finance',
  'superadmin',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that must clear MFA before any session is issued (Phase 0 §3.2). */
export const MFA_MANDATORY_ROLES: readonly Role[] = Object.freeze([
  'university_admin',
  'university_staff',
  'trust_agent',
  'ops',
  'finance',
  'superadmin',
]);

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((role) => MFA_MANDATORY_ROLES.includes(role));
}

/** Permissions are `<resource>:<action>`; the resource half is the audit object type. */
export const PERMISSIONS = [
  'institution:read',
  'institution:write',
  'institution:verify',
  'partnership:read',
  'partnership:write',
  'partnership:revoke',
  'campus:write',
  'program:read',
  'program:write',
  'program:publish',
  'intake:write',
  'requirement:write',
  'catalogue:import',
  'catalogue:sync',
  'guide:read',
  'guide:verify',
  'application:read',
  'application:write',
  'application:submit',
  'offer:read',
  'offer:verify',
  'audit:read',
  'user:impersonate',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The role → permission grant. Note what is *not* here: `university_admin` cannot
 * verify its own institution, and no role outside Trust can. Self-verification is
 * the failure mode this table exists to prevent (Phase 1 §2).
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  student: ['institution:read', 'program:read', 'application:read', 'application:write', 'offer:read'],
  guide: ['institution:read', 'program:read'],
  university_staff: [
    'institution:read',
    'partnership:read',
    'program:read',
    'program:write',
    'intake:write',
    'requirement:write',
    'application:read',
    'offer:read',
  ],
  university_admin: [
    'institution:read',
    'institution:write',
    'partnership:read',
    'campus:write',
    'program:read',
    'program:write',
    'program:publish',
    'intake:write',
    'requirement:write',
    'catalogue:import',
    'guide:read',
    'application:read',
    'offer:read',
  ],
  trust_agent: [
    'institution:read',
    'institution:verify',
    'partnership:read',
    'partnership:write',
    'partnership:revoke',
    'program:read',
    'guide:read',
    'guide:verify',
    'offer:verify',
    'audit:read',
  ],
  ops: [
    'institution:read',
    'institution:write',
    'partnership:read',
    'partnership:write',
    'campus:write',
    'program:read',
    'program:write',
    'program:publish',
    'intake:write',
    'requirement:write',
    'catalogue:import',
    'catalogue:sync',
    'guide:read',
    'application:read',
    'offer:read',
    'audit:read',
  ],
  finance: ['institution:read', 'partnership:read', 'program:read', 'offer:read', 'audit:read'],
  superadmin: PERMISSIONS,
});

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

/**
 * Consent scopes are separate, revocable grants (Phase 0 §3.2). A student
 * consenting to guide contact has not consented to document sharing, and neither
 * implies consent to submit an application to a university.
 */
export const CONSENT_SCOPES = [
  'guide_access',
  'document_share',
  'university_submission',
  'marketing_contact',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const ConsentGrantSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  grantedAt: z.iso.datetime(),
  /** A grant with no expiry is still revocable; `revokedAt` wins over everything. */
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  /** What the consent is scoped to — an institution id, a guide id, a document id. */
  subjectId: z.string().nullable(),
});

export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export function isConsentActive(grant: ConsentGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && new Date(grant.expiresAt) <= now) return false;
  return new Date(grant.grantedAt) <= now;
}

/** The evaluated authorization context attached to every request. */
export interface AccessContext {
  userId: string;
  roles: Role[];
  /** Institution the actor belongs to, if any. Students and ops have none. */
  organisationId: string | null;
  permissions: Set<Permission>;
  mfaSatisfied: boolean;
  consents: ConsentGrant[];
}
