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
  'application.created',
  'application.updated',
  'application.state_changed',
  'application.ready_blocked',
  'application.snapshot_created',
  'application.consent_recorded',
  'application.submission_attempted',
  'application.submitted',
  'application.submission_failed',
  'application.submission_dead_lettered',
  'application.operator_submitted',
  'application.status_received',
  'application.task_created',
  'application.task_completed',
  'connector.event_received',
  'connector.event_rejected',
  'connector.poll_completed',

  // Phase 5 — offers. `offer.mismatch_detected` is deliberately its own action
  // rather than a flavour of `offer.unpublished`: a displayed discount that
  // differs from its source is a trust incident, and it has to be findable as
  // one in the log without reading every unpublish reason.
  'offer.created',
  'offer.superseded',
  'offer.verified',
  'offer.published',
  'offer.unpublished',
  'offer.expired',
  'offer.source_checked',
  'offer.mismatch_detected',
  'offer.attached',
  'offer.attachment_changed',
  'application.admission_offer_recorded',

  // Phase 6 — the admin consoles (#8).
  //
  // `evidence.viewed` is the unusual one: reading is normally not an auditable
  // event, and auditing every read would bury the writes. Verification evidence
  // is the exception the issue names explicitly — "viewing it is itself an
  // audited action" — because the harm from an unnecessary look at somebody's
  // identity document happens at the moment of looking, with nothing left
  // behind to find later.
  'auth.step_up_succeeded',
  'auth.step_up_failed',
  'console.entered',
  'evidence.viewed',
  'sanction.applied',
  'sanction.reversed',
  'requirement.reviewed',
  'impersonation.started',
  'impersonation.ended',
  'impersonation.expired',
  'notification.template_updated',
  'payout.initiated',
  'payout.approved',
  'payout.rejected',
  'payout.paid',
  'refund.issued',
  'org_user.invited',
  'org_user.role_changed',
  'org_user.removed',
  'connector.enabled',
  'connector.disabled',
  'connector.retried',

  // Phase 7 — privacy workflows (#9).
  'privacy.export_requested',
  'privacy.export_completed',
  'privacy.erasure_requested',
  'privacy.erasure_completed',
  'privacy.erasure_refused',
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
  // Phase 4. A connector's credentials pass through the submission path, and a
  // partner's signing secret in an audit row would be a gift to anyone who can
  // read the trail — which, by design, includes Trust and ops.
  'signingSecret',
  'webhookSecret',
  'connectorSecret',
  'clientSecret',
  'continuationUrl',
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
