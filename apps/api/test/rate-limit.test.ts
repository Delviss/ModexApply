import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, decide, rateLimitMessage } from '@modex/contracts';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service.js';

/**
 * The limiter's own behaviour, with no Redis.
 *
 * Passing `null` exercises the in-process fallback deliberately: that path runs
 * in production the moment Redis blips, and a fallback nobody tests is a
 * fallback that fails open on the day it matters.
 */
describe('rate limiting', () => {
  it('permits exactly the budget and then refuses', async () => {
    const limiter = new RateLimitService(null);
    const budget = RATE_LIMITS['auth.mfa'].limit;

    for (let attempt = 1; attempt <= budget; attempt += 1) {
      const decision = await limiter.consume('auth.mfa', 'user-1');
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(budget - attempt);
    }

    const refused = await limiter.consume('auth.mfa', 'user-1');
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.resetSeconds).toBeGreaterThan(0);
  });

  it('counts separate identities separately', async () => {
    const limiter = new RateLimitService(null);
    for (let attempt = 0; attempt < RATE_LIMITS['auth.mfa'].limit; attempt += 1) {
      await limiter.consume('auth.mfa', 'user-1');
    }
    expect((await limiter.consume('auth.mfa', 'user-1')).allowed).toBe(false);
    // The bypass this is about: rotating identity must not inherit a used-up
    // budget, but it must not *reset* somebody else's either.
    expect((await limiter.consume('auth.mfa', 'user-2')).allowed).toBe(true);
  });

  it('counts separate budgets separately', async () => {
    const limiter = new RateLimitService(null);
    for (let attempt = 0; attempt < RATE_LIMITS['auth.mfa'].limit; attempt += 1) {
      await limiter.consume('auth.mfa', 'user-1');
    }
    expect((await limiter.consume('auth.step_up', 'user-1')).allowed).toBe(true);
  });

  it('reports the full window before a counter has a TTL', () => {
    const decision = decide(RATE_LIMITS['auth.login'], 1, -1);
    expect(decision.resetSeconds).toBe(RATE_LIMITS['auth.login'].windowSeconds);
  });

  it('tells a person what to do rather than that they are blocked', () => {
    const message = rateLimitMessage({ allowed: false, limit: 10, remaining: 0, resetSeconds: 300 });
    expect(message).toContain('Try again');
    expect(message.toLowerCase()).not.toContain('blocked');
  });

  it('keys sign-in on the subject, so an address change does not reset it', () => {
    // The budget's own declaration is the guarantee; the guard reads it.
    expect(RATE_LIMITS['auth.login'].key).toBe('subject');
    expect(RATE_LIMITS['auth.login.address'].key).toBe('address');
  });

  it('keeps the code budgets in two halves, and the per-account one tighter', () => {
    // The guard runs before authentication, so its budget can only be
    // address-keyed — which is useless as a per-person limit and punishing for
    // an office behind one address. The tight limit is enforced in the service,
    // where the account is known.
    expect(RATE_LIMITS['auth.mfa'].key).toBe('address');
    expect(RATE_LIMITS['auth.mfa.account'].key).toBe('actor');
    expect(RATE_LIMITS['auth.mfa.account'].limit).toBeLessThan(RATE_LIMITS['auth.mfa'].limit);
    expect(RATE_LIMITS['auth.step_up.account'].limit).toBeLessThan(
      RATE_LIMITS['auth.step_up'].limit,
    );
  });
});
