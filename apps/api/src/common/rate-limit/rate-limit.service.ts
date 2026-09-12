import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { RATE_LIMITS, decide, type RateLimitDecision, type RateLimitName } from '@modex/contracts';

/**
 * Fixed-window rate limiting (Phase 7 §1).
 *
 * Redis-backed, because the limit has to hold across instances: a per-process
 * counter multiplied by however many pods are running is not a limit, it is a
 * suggestion. `INCR` plus `EXPIRE` on first use is the whole algorithm — atomic
 * in Redis, and cheap enough to sit in front of every request.
 *
 * **What happens when Redis is down** is the decision worth arguing about.
 * Failing closed would turn a cache blip into a total outage; failing fully
 * open would remove the only thing standing between a credential-stuffing run
 * and the login route. So the fallback is an in-process counter with the same
 * budgets: imperfect across instances, unmistakably better than nothing, and it
 * logs loudly enough that nobody mistakes it for the normal state.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private redis: Redis | null = null;
  private redisHealthy = false;
  /** The fallback. Bounded, so a flood of distinct keys cannot exhaust memory. */
  private readonly local = new Map<string, { count: number; expiresAt: number }>();
  private static readonly LOCAL_MAX_KEYS = 50_000;

  constructor(connectionUrl: string | null) {
    if (connectionUrl === null) return;
    this.redis = new Redis(connectionUrl, {
      maxRetriesPerRequest: 2,
      // A rate limiter that queues requests while Redis reconnects turns a blip
      // into latency on every route. It should answer now, from the fallback.
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.redis.on('ready', () => {
      this.redisHealthy = true;
    });
    this.redis.on('error', (error: Error) => {
      if (this.redisHealthy) this.logger.error(`Rate limiter lost Redis: ${error.message}`);
      this.redisHealthy = false;
    });
    void this.redis.connect().catch((error: unknown) => {
      this.logger.warn(
        `Rate limiter could not reach Redis (${String(error)}); using the in-process fallback.`,
      );
    });
  }

  async consume(name: RateLimitName, identity: string): Promise<RateLimitDecision> {
    const budget = RATE_LIMITS[name];
    // The identity is hashed: keys land in Redis, Redis lands in snapshots, and
    // an email address in a snapshot is personal data nobody remembered to map.
    const key = `ratelimit:${name}:${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;

    if (this.redis !== null && this.redisHealthy) {
      try {
        const used = await this.redis.incr(key);
        if (used === 1) await this.redis.expire(key, budget.windowSeconds);
        const ttl = await this.redis.ttl(key);
        return decide(budget, used, ttl);
      } catch (error) {
        this.logger.error(`Rate limit check failed against Redis: ${String(error)}`);
        this.redisHealthy = false;
      }
    }

    return this.consumeLocally(key, budget.windowSeconds, name);
  }

  private consumeLocally(
    key: string,
    windowSeconds: number,
    name: RateLimitName,
  ): RateLimitDecision {
    const now = Date.now();
    if (this.local.size > RateLimitService.LOCAL_MAX_KEYS) this.sweep(now);

    const existing = this.local.get(key);
    if (existing === undefined || existing.expiresAt <= now) {
      this.local.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
      return decide(RATE_LIMITS[name], 1, windowSeconds);
    }

    existing.count += 1;
    return decide(
      RATE_LIMITS[name],
      existing.count,
      Math.ceil((existing.expiresAt - now) / 1_000),
    );
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.local) {
      if (entry.expiresAt <= now) this.local.delete(key);
    }
    // Still full of live windows: drop the oldest half rather than grow without
    // bound. Losing counters is the lesser failure; running out of memory
    // takes the API with it.
    if (this.local.size > RateLimitService.LOCAL_MAX_KEYS) {
      const keys = [...this.local.keys()].slice(0, Math.floor(this.local.size / 2));
      for (const key of keys) this.local.delete(key);
      this.logger.warn('Rate limiter fallback evicted half its counters under pressure.');
    }
  }

  /** For tests and the health endpoint. */
  get usingRedis(): boolean {
    return this.redisHealthy;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
