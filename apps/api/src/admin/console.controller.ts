import { Controller, Get } from '@nestjs/common';
import {
  STEP_UP_TTL_MINUTES,
  consolesFor,
  isStepUpFresh,
  stepUpExpiresAt,
  type AccessContext,
} from '@modex/contracts';
import { Actor } from '../auth/decorators/actor.decorator.js';
import { ImpersonationService } from './impersonation.service.js';

/**
 * What the signed-in actor may open, and whether they are currently elevated.
 *
 * The shell calls this on every load. It is not an authorization decision —
 * every console route checks its own permission and its own step-up — it is
 * what lets the shell render the right nav and the right interstitial instead
 * of discovering both through a sequence of 401s.
 */
@Controller({ path: 'admin', version: '1' })
export class ConsoleController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Get('session')
  async session(@Actor() access: AccessContext) {
    const fresh = isStepUpFresh(access.stepUpAt);
    return {
      userId: access.userId,
      roles: access.roles,
      organisationId: access.organisationId,
      consoles: consolesFor(access.roles),
      permissions: [...access.permissions].sort(),
      stepUp: {
        fresh,
        at: access.stepUpAt,
        expiresAt: access.stepUpAt === null ? null : stepUpExpiresAt(access.stepUpAt),
        ttlMinutes: STEP_UP_TTL_MINUTES,
      },
      /**
       * Non-null when this very session is a support impersonation. The shell
       * renders the persistent warning banner from it, and the student's own
       * pages render theirs from `/me/support-access`.
       */
      impersonatedBy: access.impersonatedBy,
    };
  }

  /**
   * The subject's side of impersonation: every support visit to this account,
   * open or finished.
   *
   * Deliberately reachable by any signed-in user with no extra permission — it
   * is their own account's history, and needing a permission to read what was
   * done to you is not a transparency feature.
   */
  @Get('me/support-access')
  async supportAccess(@Actor() access: AccessContext) {
    return { data: await this.impersonation.forSubject(access.userId) };
  }
}
