import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { RATE_LIMITS, rateLimitMessage, type RateLimitName } from '@modex/contracts';
import type { Response } from 'express';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from '../../auth/decorators/actor.decorator.js';
import { RATE_LIMIT_KEY, type RateLimitRequirement } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';

/**
 * Enforces `@RateLimit(...)`.
 *
 * Runs before authentication in the guard order, because the routes most worth
 * limiting are the ones nobody has authenticated to yet.
 *
 * The address it counts is `request.ip`, which Express derives from
 * `X-Forwarded-For` **only** as far as the configured `trust proxy` depth
 * allows. That configuration is what makes header spoofing useless: a client
 * appending its own `X-Forwarded-For` entries cannot push its real address out
 * of the trusted window.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<RateLimitRequirement>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requirement === undefined) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    for (const name of requirement.names) {
      const identity = this.identityFor(name, request, requirement.subjectField);
      if (identity === null) continue;

      const decision = await this.limiter.consume(name, identity);
      response.setHeader('x-ratelimit-limit', String(decision.limit));
      response.setHeader('x-ratelimit-remaining', String(decision.remaining));

      if (!decision.allowed) {
        response.setHeader('retry-after', String(decision.resetSeconds));
        throw new AppError('rate_limited', rateLimitMessage(decision), {
          details: { retryAfterSeconds: decision.resetSeconds },
        });
      }
    }

    return true;
  }

  private identityFor(
    name: RateLimitName,
    request: AuthenticatedRequest,
    subjectField: string | undefined,
  ): string | null {
    const budget = RATE_LIMITS[name];
    const address = request.ip ?? 'unknown';

    if (budget.key === 'address') return `ip:${address}`;

    if (budget.key === 'subject') {
      const body = request.body as Record<string, unknown> | undefined;
      const raw = subjectField === undefined ? undefined : body?.[subjectField];
      if (typeof raw !== 'string' || raw.trim() === '') return null;
      // Normalised, so `Ada@Example.com ` and `ada@example.com` share a counter
      // rather than giving an attacker a fresh budget per capitalisation.
      return `subject:${createHash('sha256').update(raw.trim().toLowerCase()).digest('hex')}`;
    }

    // `actor`: the signed-in user, falling back to the address. The fallback is
    // what stops an anonymous caller from having no counter at all.
    const userId = request.access?.userId;
    return userId === undefined ? `ip:${address}` : `user:${userId}`;
  }
}
