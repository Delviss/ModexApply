import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@modex/contracts';
import { AppError } from '../../common/errors/app-error.js';
import { PERMISSIONS_KEY } from '../decorators/access.decorators.js';
import type { AuthenticatedRequest } from '../decorators/actor.decorator.js';
import { assertPermission } from '../access-context.js';

/**
 * Enforces `@RequirePermissions(...)`.
 *
 * This is the RBAC half only. The organisation boundary and resource-level
 * permission are checked in the service layer against the actual row, because a
 * guard cannot know which institution a record belongs to before it is loaded --
 * and a check that runs before the row is read is a check that can be bypassed
 * by asking for a different row.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = request.access;
    if (access === undefined) {
      throw new AppError('unauthenticated', 'This request is not authenticated.');
    }

    for (const permission of required) assertPermission(access, permission);
    return true;
  }
}
