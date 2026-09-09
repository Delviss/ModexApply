import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { requiresMfa } from '@modex/contracts';
import { AppError } from '../../common/errors/app-error.js';
import { currentContext } from '../../common/observability/request-context.js';
import { PUBLIC_KEY } from '../decorators/access.decorators.js';
import type { AuthenticatedRequest } from '../decorators/actor.decorator.js';
import type { SessionResolver } from '../session-resolver.js';

/**
 * Authenticates the request and attaches the evaluated access context.
 *
 * Registered globally, so the default is "denied unless marked public". A route
 * added without a decorator is a route nobody can reach, which is the failure
 * mode you want.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') === true ? header.slice(7) : null;

    if (token === null) {
      if (isPublic === true) return true;
      throw new AppError('unauthenticated', 'This request is not authenticated.');
    }

    const access = await this.sessions.resolve(token);

    // A staff session that has not cleared MFA is rejected outright rather than
    // downgraded, so no endpoint has to remember to re-check.
    if (requiresMfa(access.roles) && !access.mfaSatisfied) {
      throw new AppError('mfa_required', 'This role requires multi-factor authentication.');
    }

    request.access = access;
    const ambient = currentContext();
    if (ambient !== undefined) {
      ambient.userId = access.userId;
      ambient.organisationId = access.organisationId ?? undefined;
    }
    return true;
  }
}
