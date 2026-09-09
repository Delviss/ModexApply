import { z } from 'zod';

/**
 * The single error envelope for every `/v1` response (Phase 0 §3.5): a machine
 * code, a human message, the request ID that produced it, and field-level detail.
 *
 * Adding a new failure mode means adding a code here, not inventing a shape.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'token_expired',
  'mfa_required',
  'forbidden',
  'organisation_boundary',
  'consent_missing',
  'not_found',
  'conflict',
  'idempotency_key_reuse',
  'precondition_failed',
  'state_transition_rejected',
  'rate_limited',
  'dependency_unavailable',
  'connector_rejected',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const FieldErrorSchema = z.object({
  /** Dotted path into the request body, e.g. `intakes.0.applicationDeadline`. */
  field: z.string(),
  code: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    /** Same value as the `x-correlation-id` header; ties the failure to audit events. */
    correlationId: z.string().optional(),
    fieldErrors: z.array(FieldErrorSchema).optional(),
    /** Safe, non-sensitive context. Never document content, tokens or secrets. */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** HTTP status each code maps to. The API layer never picks a status by hand. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  validation_failed: 422,
  unauthenticated: 401,
  token_expired: 401,
  mfa_required: 401,
  forbidden: 403,
  organisation_boundary: 403,
  consent_missing: 403,
  not_found: 404,
  conflict: 409,
  idempotency_key_reuse: 409,
  precondition_failed: 412,
  state_transition_rejected: 422,
  rate_limited: 429,
  dependency_unavailable: 503,
  connector_rejected: 502,
  internal_error: 500,
});

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  extra: Omit<ErrorEnvelope['error'], 'code' | 'message' | 'requestId'> = {},
): ErrorEnvelope {
  return { error: { code, message, requestId, ...extra } };
}
