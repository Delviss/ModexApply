import { SetMetadata } from '@nestjs/common';
import type { RateLimitName } from '@modex/contracts';

export const RATE_LIMIT_KEY = 'modex:rate-limit';

export interface RateLimitRequirement {
  names: RateLimitName[];
  /**
   * Body field the `subject`-keyed budgets count against — the email on a
   * sign-in, for instance. Without it a `subject` budget has nothing to key on
   * and falls back to the address, which is exactly the bypass it exists to
   * close.
   */
  subjectField?: string;
}

/**
 * Applies one or more rate-limit budgets to a route.
 *
 * Several are normal: sign-in carries an email-keyed budget *and* an
 * address-keyed one, because each catches an attack the other misses.
 */
export const RateLimit = (names: RateLimitName[], subjectField?: string) =>
  SetMetadata<string, RateLimitRequirement>(RATE_LIMIT_KEY, { names, subjectField });
