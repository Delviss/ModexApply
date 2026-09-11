import { Global, Module } from '@nestjs/common';
import { loadEnv } from '../../config/env.js';
import { RateLimitService } from './rate-limit.service.js';

/**
 * Global, because two very different layers need the same counters.
 *
 * The guard limits by address before anybody is authenticated. Services limit
 * by *account* once they know who is asking — which is the only place a
 * per-account limit can be enforced, since the guard runs before authentication
 * and cannot tell one signed-in user from another.
 */
@Global()
@Module({
  providers: [
    { provide: RateLimitService, useFactory: () => new RateLimitService(loadEnv().REDIS_URL) },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
