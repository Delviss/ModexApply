import { z } from 'zod';

/**
 * `AuditEvent` is append-only (Phase 0 §3.3). The database enforces it with
 * revoked UPDATE/DELETE grants and a trigger; this module is the shape and the
 * redaction rule.
 *
 * Logs never contain raw document content, tokens or secrets — `metadata` is
 * passed through `redactAuditMetadata` before it is written, not after.
 */
export const AUDIT_ACTIONS = [
  'user.registered',
  'user.login_succeeded',
  'user.login_failed',
  'user.mfa_enrolled',
  'user.mfa_challenge_failed',
  'user.password_changed',
  'user.session_revoked',
  'user.role_granted',
  'user.role_revoked',
  'consent.granted',
  'consent.revoked',
  'institution.created',
  'institution.updated',
  'institution.verification_advanced',
  'institution.verification_failed',
  'institution.domain_challenge_issued',
  'institution.domain_confirmed',
  'institution.manual_override',
  'partnership.created',
  'partnership.activated',
  'partnership.suspended',
  'partnership.revoked',
  'contact.verified',
  'program.created',
  'program.superseded',
  'program.published',
  'program.unpublished',
  'intake.updated',
  'requirement.updated',
  'catalogue.import_dry_run',
  'catalogue.import_committed',
  'catalogue.sync_succeeded',
  'catalogue.sync_failed',
  'catalogue.marked_stale',
  'document.uploaded',
  'document.version_created',
  'document.scan_completed',
  'document.quarantined',
  'document.download_url_issued',
  'document.deleted',
  'profile.created',
  'profile.updated',
  'eligibility.override_applied',
  'guide.registered',
  'guide.evidence_submitted',
  'guide.verification_advanced',
  'guide.verified',
  'guide.reverification_notified',
  'guide.restricted',
  'guide.suspended',
  'guide.reinstated',
  'guide.profile_updated',
  'guide.identity_drift_detected',
  'conversation.opened',
  'conversation.closed',
  'conversation.suspended',
  'message.sent',
  'message.flagged',
  'message.reported',
  'session.booked',
  'session.cancelled',
  'session.completed',
  'reward.earned',
  'reward.state_changed',
  'trust_case.opened',
  'trust_case.transitioned',
  'qa.answer_submitted',
  'qa.answer_published',
  'qa.answer_rejected',
  'application.submitted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AuditAuthContextSchema = z.object({
  roles: z.array(z.string()),
  organisationId: z.string().nullable(),
  ipHash: z.string().nullable(),
  userAgent: z.string().nullable(),
  mfaSatisfied: z.boolean(),
});

export const AuditEventSchema = z.object({
  id: z.string(),
  /** `null` only for system/job actors, which set `actorType: 'system'`. */
  actorId: z.string().nullable(),
  actorType: z.enum(['user', 'system', 'connector']),
  action: z.enum(AUDIT_ACTIONS),
  objectType: z.string(),
  objectId: z.string(),
  timestamp: z.iso.datetime(),
  authContext: AuditAuthContextSchema,
  correlationId: z.string(),
  /**
   * Hash chain over the previous event, so a deletion at the storage layer is
   * detectable even though the application has no delete path.
   */
  integrityRef: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Keys whose values never reach the audit log or any structured log line. */
export const REDACTED_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'documentContent',
  'fileBytes',
  'dnsChallengeToken',
  'contractBody',
  'mfaSecret',
  'otp',
] as const;

const REDACTED_LOOKUP = new Set<string>(REDACTED_KEYS.map((k) => k.toLowerCase()));

export function redactAuditMetadata(
  metadata: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 6) return { truncated: true };
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACTED_LOOKUP.has(key.toLowerCase())) {
      output[key] = '[redacted]';
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = redactAuditMetadata(value as Record<string, unknown>, depth + 1);
      continue;
    }
    if (typeof value === 'string' && value.length > 2048) {
      output[key] = `${value.slice(0, 2048)}…[truncated]`;
      continue;
    }
    output[key] = value;
  }
  return output;
}
