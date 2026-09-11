/**
 * Rate limits (Phase 7 §1, TRD §23).
 *
 * The budgets live in the contracts package because two very different readers
 * need the same numbers: the API, which enforces them, and the documentation
 * and support runbooks, which have to tell a student why they have been asked
 * to wait. A limit that is only in the server is a limit nobody can explain.
 *
 * Three properties matter more than the exact numbers.
 *
 * **Identity, not address.** An authenticated request is counted against the
 * user; sign-in attempts are counted against the *email* as well as the
 * address. Counting by IP alone means a session-rotating or IP-rotating
 * attacker resets the counter at will, which is the "rate-limit bypass" case
 * the test surface names explicitly.
 *
 * **The window is fixed, not rolling-per-request.** A fixed window is cheap and
 * boring: one counter, one expiry. It permits a burst at a window boundary, and
 * that is an accepted trade — these budgets exist to stop automation, not to
 * shape traffic to the millisecond.
 *
 * **Writes cost more than reads.** The expensive things to abuse are the ones
 * that send mail, start a scan, or create a record somebody has to review.
 */

export interface RateLimitBudget {
  /** Requests permitted in the window. */
  limit: number;
  windowSeconds: number;
  /**
   * What the counter is keyed on.
   *
   * `actor` — the signed-in user, falling back to the address when anonymous.
   * `address` — the address alone, for routes reached before authentication.
   * `subject` — a value from the request body, such as the email being signed
   *   in as. The strongest of the three for credential attacks, because it is
   *   the only one an attacker cannot rotate.
   */
  key: 'actor' | 'address' | 'subject';
}

export const RATE_LIMITS = {
  /**
   * Sign-in. Keyed on the email, so distributing the attempt across a botnet
   * does not multiply the budget. The address-keyed limit below runs alongside
   * it and catches spraying across many accounts from one place.
   */
  'auth.login': { limit: 10, windowSeconds: 300, key: 'subject' },
  'auth.login.address': { limit: 30, windowSeconds: 300, key: 'address' },
  'auth.register': { limit: 5, windowSeconds: 3_600, key: 'address' },
  /**
   * A second factor is six digits, so the budget that matters is per *account*
   * — and the guard cannot enforce that, because it runs before authentication
   * and every anonymous request looks the same to it. So there are two:
   *
   * `auth.mfa` is address-keyed and deliberately loose. It stops one host
   * grinding codes, and it is sized for an office or a university behind one
   * address rather than for a single person.
   *
   * `auth.mfa.account` is consumed inside the service, where the account is
   * known. Ten wrong codes in five minutes is somebody guessing.
   */
  'auth.mfa': { limit: 60, windowSeconds: 300, key: 'address' },
  'auth.mfa.account': { limit: 10, windowSeconds: 300, key: 'actor' },
  'auth.step_up': { limit: 60, windowSeconds: 300, key: 'address' },
  'auth.step_up.account': { limit: 10, windowSeconds: 300, key: 'actor' },
  'auth.refresh': { limit: 60, windowSeconds: 300, key: 'actor' },

  /** Scanning costs money and time; a bulk upload is a legitimate 30 files. */
  'document.upload': { limit: 30, windowSeconds: 3_600, key: 'actor' },
  'document.download_url': { limit: 120, windowSeconds: 3_600, key: 'actor' },

  'search.query': { limit: 120, windowSeconds: 60, key: 'actor' },

  /** Each one makes work for a human, so the budget is a human-sized number. */
  'trust.report': { limit: 20, windowSeconds: 3_600, key: 'actor' },
  'message.send': { limit: 60, windowSeconds: 3_600, key: 'actor' },
  'application.submit': { limit: 20, windowSeconds: 3_600, key: 'actor' },

  /** Inbound partner traffic, per connector. Generous, but not unbounded. */
  'connector.webhook': { limit: 600, windowSeconds: 60, key: 'address' },
} as const satisfies Record<string, RateLimitBudget>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. Rendered in the `retry-after` header. */
  resetSeconds: number;
}

export function decide(
  budget: RateLimitBudget,
  used: number,
  ttlSeconds: number,
): RateLimitDecision {
  return {
    allowed: used <= budget.limit,
    limit: budget.limit,
    remaining: Math.max(0, budget.limit - used),
    // A counter with no TTL yet (the very first request in a window) reports
    // the full window rather than zero, so a client never reads "retry in 0s".
    resetSeconds: ttlSeconds > 0 ? ttlSeconds : budget.windowSeconds,
  };
}

/** What the student is told. Never "you have been blocked". */
export function rateLimitMessage(decision: RateLimitDecision): string {
  const minutes = Math.ceil(decision.resetSeconds / 60);
  return minutes <= 1
    ? 'That is a few too many attempts in a row. Try again in a minute.'
    : `That is a few too many attempts in a row. Try again in about ${minutes} minutes.`;
}
