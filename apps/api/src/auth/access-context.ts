import {
  permissionsForRoles,
  requiresMfa,
  type AccessContext,
  type ConsentGrant,
  type Permission,
  type Role,
} from '@modex/contracts';
import { AppError } from '../common/errors/app-error.js';

/**
 * Authorization is RBAC + organisation boundary + resource permission + consent
 * scope (Phase 0 section 3.2). All four are checked here, server-side; nothing
 * on the client is ever load-bearing.
 */
export interface AccessContextInput {
  userId: string;
  roles: Role[];
  organisationId: string | null;
  mfaSatisfied: boolean;
  consents: ConsentGrant[];
}

export function buildAccessContext(input: AccessContextInput): AccessContext {
  return {
    userId: input.userId,
    roles: input.roles,
    organisationId: input.organisationId,
    permissions: permissionsForRoles(input.roles),
    mfaSatisfied: input.mfaSatisfied,
    consents: input.consents,
  };
}

export function hasPermission(context: AccessContext, permission: Permission): boolean {
  return context.permissions.has(permission);
}

export function assertPermission(context: AccessContext, permission: Permission): void {
  // MFA is mandatory for staff and high-risk roles, and it gates the whole
  // session rather than individual endpoints -- a staff session without MFA is
  // not a reduced session, it is not a session.
  if (requiresMfa(context.roles) && !context.mfaSatisfied) {
    throw new AppError('mfa_required', 'This role requires multi-factor authentication.');
  }
  if (!context.permissions.has(permission)) {
    throw AppError.forbidden(`You do not have the ${permission} permission.`);
  }
}

/**
 * The organisation boundary.
 *
 * A university administrator holds `program:write` — but only for their own
 * institution. Role alone never grants access to a row, so every
 * institution-scoped resource passes through here.
 *
 * Modex staff roles (`ops`, `trust_agent`, `finance`, `superadmin`) have no
 * organisation and are allowed across the boundary; that crossing is exactly the
 * kind of access the audit trail exists to record.
 */
const CROSS_ORGANISATION_ROLES: readonly Role[] = ['ops', 'trust_agent', 'finance', 'superadmin'];

export function canCrossOrganisations(context: AccessContext): boolean {
  return context.roles.some((role) => CROSS_ORGANISATION_ROLES.includes(role));
}

export function assertOrganisationAccess(
  context: AccessContext,
  resourceOrganisationId: string | null,
): void {
  if (canCrossOrganisations(context)) return;
  if (resourceOrganisationId === null) return;
  if (context.organisationId === resourceOrganisationId) return;

  // `organisation_boundary` rather than `not_found`, because the caller is a
  // legitimate authenticated user hitting a boundary, and blurring the two makes
  // real support requests unanswerable. The message names no institution.
  throw new AppError(
    'organisation_boundary',
    'This record belongs to another institution.',
  );
}

/** Consent scopes are separate, revocable grants; an active session is not consent. */
export function assertConsent(
  context: AccessContext,
  scope: ConsentGrant['scope'],
  subjectId: string | null = null,
  now: Date = new Date(),
): void {
  const granted = context.consents.some((grant) => {
    if (grant.scope !== scope) return false;
    if (grant.revokedAt !== null) return false;
    if (grant.expiresAt !== null && new Date(grant.expiresAt) <= now) return false;
    if (subjectId !== null && grant.subjectId !== null && grant.subjectId !== subjectId) return false;
    return new Date(grant.grantedAt) <= now;
  });
  if (!granted) {
    throw new AppError('consent_missing', `This action needs your ${scope} consent.`);
  }
}
