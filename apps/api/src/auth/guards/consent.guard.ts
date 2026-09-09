import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConsentScope } from '@modex/contracts';
import { AppError } from '../../common/errors/app-error.js';
import { CONSENT_KEY } from '../decorators/access.decorators.js';
import type { AuthenticatedRequest } from '../decorators/actor.decorator.js';
import { assertConsent } from '../access-context.js';

/**
 * Enforces `@RequireConsent(...)`.
 *
 * Consent is separate from authorization: a student who has authenticated has
 * not thereby agreed to share documents with a university, and a guide holding
 * `guide_access` on one student holds nothing on another.
 */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ConsentScope[]>(CONSENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.access;
    if (access === undefined) {
      throw new AppError('unauthenticated', 'This request is not authenticated.');
    }

    const subjectId = (request.params as Record<string, string> | undefined)?.id ?? null;
    for (const scope of required) assertConsent(access, scope, subjectId);
    return true;
  }
}
