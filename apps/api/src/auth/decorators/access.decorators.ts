import { SetMetadata } from '@nestjs/common';
import type { ConsentScope, Permission } from '@modex/contracts';

export const PERMISSIONS_KEY = 'modex:permissions';
export const CONSENT_KEY = 'modex:consent';
export const PUBLIC_KEY = 'modex:public';

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
