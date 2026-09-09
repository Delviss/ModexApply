import { z } from 'zod';

/** UUID v4 identifiers everywhere; prefixed only in logs, never in storage. */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/**
 * Idempotency keys are required on application submission, payment creation and
 * webhook processing (Phase 0 §3.5). Client-generated, opaque, and stored with
 * the response so a retry returns the original result rather than acting twice.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(16, 'Idempotency key must be at least 16 characters')
  .max(255);

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** Correlation ID threads user action → API request → job → connector call. */
export const CorrelationIdSchema = z.string().min(8).max(128);
export const CORRELATION_HEADER = 'x-correlation-id';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REQUEST_ID_HEADER = 'x-request-id';
