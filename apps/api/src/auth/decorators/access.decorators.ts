import { SetMetadata } from '@nestjs/common';
import type { ConsentScope, Permission, StepUpAction } from '@modex/contracts';

export const PERMISSIONS_KEY = 'modex:permissions';
export const CONSENT_KEY = 'modex:consent';
export const PUBLIC_KEY = 'modex:public';
export const PENDING_MFA_KEY = 'modex:pending-mfa';
export const STEP_UP_KEY = 'modex:step-up';

/**
 * Marks a route as reachable without authentication.
 *
 * Deliberately opt-in: the global guard denies by default, so forgetting a
 * decorator locks a route down rather than opening it up. Public catalogue pages
 * are the main legitimate use.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Reachable by an authenticated session that has not yet cleared MFA.
 *
 * Exactly one kind of route needs this: the MFA challenge itself. Without it a
 * staff login is a closed loop — the session cannot do anything until it
 * satisfies MFA, and it cannot satisfy MFA without doing something.
 */
export const AllowPendingMfa = () => SetMetadata(PENDING_MFA_KEY, true);

/**
 * Requires a fresh step-up challenge (Phase 6 §2).
 *
 * Separate from `@RequirePermissions` on purpose: holding `evidence:read` is a
 * statement about the person, and stepping up is a statement about the moment.
 * Console entry, evidence viewing and sanctions each need both.
 */
export const RequireStepUp = (action: StepUpAction) => SetMetadata(STEP_UP_KEY, action);

export interface ConsentRequirement {
  scopes: ConsentScope[];
  /**
   * Route parameter naming the consent subject.
   *
   * Defaults to `id`, which is what every Phase 0/1 route used. Routes that
   * address their subject differently -- `:documentId`, `:institutionId` --
   * must say so, or the guard has no subject to check and silently degrades to
   * a scope-only check: "this student consented to share *something* with
   * *somebody*", which is not the question being asked.
   */
  subjectParam: string;
}

export const RequireConsent = (...scopes: ConsentScope[]) =>
  SetMetadata<string, ConsentRequirement>(CONSENT_KEY, { scopes, subjectParam: 'id' });

/** `@RequireConsent` where the subject is named by a different route parameter. */
export const RequireConsentOn = (subjectParam: string, ...scopes: ConsentScope[]) =>
  SetMetadata<string, ConsentRequirement>(CONSENT_KEY, { scopes, subjectParam });
