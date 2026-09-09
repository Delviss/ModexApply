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

export const RequireConsent = (...scopes: ConsentScope[]) => SetMetadata(CONSENT_KEY, scopes);
