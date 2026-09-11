import { createHmac, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_TOLERANCE_SECONDS, webhookSigningPayload } from '@modex/contracts';

/**
 * HMAC signing and verification for inbound connector webhooks (Phase 4 §3).
 *
 * The *signed material* is defined by `webhookSigningPayload` in the contracts
 * package, so a partner integrating against our published contract and this
 * verifier are reading one definition rather than two. Only the keyed digest
 * lives here, where `node:crypto` is available and no browser bundle reaches.
 */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(webhookSigningPayload(timestamp, rawBody), 'utf8')
    .digest('hex');
}

export type WebhookVerification =
  | { valid: true }
  | { valid: false; reason: 'malformed' | 'stale_timestamp' | 'bad_signature' };

/**
 * The signature covers a timestamp, and that is not decoration.
 *
 * Without it a captured request is valid forever, and "replay-safe" would mean
 * only "we store the event id" — which stops a duplicate but not an attacker
 * replaying a six-month-old `offer_made` at a moment of their choosing. The
 * unique index on `(connectorId, providerEventId)` and this window stop
 * different things, and both are needed.
 */
export function verifyWebhook(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  now: Date = new Date(),
): WebhookVerification {
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || signature.length === 0) {
    return { valid: false, reason: 'malformed' };
  }
  if (Math.abs(now.getTime() / 1000 - sentAt) > WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, and comparing lengths first
  // leaks only the length — which hex encoding already fixes at 64.
  if (expected.length !== provided.length) return { valid: false, reason: 'bad_signature' };
  return timingSafeEqual(expected, provided)
    ? { valid: true }
    : { valid: false, reason: 'bad_signature' };
}
