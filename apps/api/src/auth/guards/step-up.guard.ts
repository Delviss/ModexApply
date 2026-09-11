import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { STEP_UP_TTL_MINUTES, isStepUpFresh, type StepUpAction } from '@modex/contracts';
import { AppError } from '../../common/errors/app-error.js';
import { STEP_UP_KEY } from '../decorators/access.decorators.js';
import type { AuthenticatedRequest } from '../decorators/actor.decorator.js';

/**
 * Enforces `@RequireStepUp(...)`.
 *
 * The freshness window is compared against the session's `stepUpAt` column,
 * re-read on every request by the session resolver. Nothing here trusts a claim
 * in the token: an access token lives fifteen minutes, and an elevation that
 * rode along inside one would survive its own revocation.
 *
 * The refusal carries `step_up_required` rather than `forbidden`, because the
 * client's correct response is to show the interstitial and retry — not to tell
 * the operator they lack permission for work they do every day.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StepUpAction>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) return true;

    const access = context.switchToHttp().getRequest<AuthenticatedRequest>().access;
    if (access === undefined) {
      throw new AppError('unauthenticated', 'This request is not authenticated.');
    }

    if (!isStepUpFresh(access.stepUpAt)) {
      throw new AppError(
        'step_up_required',
        'Confirm it is you before continuing. This check lasts ' +
          `${STEP_UP_TTL_MINUTES} minutes.`,
        { details: { stepUpAction: required } },
      );
    }
    return true;
  }
}
