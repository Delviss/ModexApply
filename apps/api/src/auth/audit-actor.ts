import type { AccessContext } from '@modex/contracts';
import type { AuditActor } from '../audit/audit.service.js';

/** Projects an access context into the actor shape the audit log records. */
export function toAuditActor(
  access: AccessContext,
  request?: { ip?: string | null; userAgent?: string | null },
): AuditActor {
  return {
    id: access.userId,
    type: 'user',
    roles: access.roles,
    organisationId: access.organisationId,
    mfaSatisfied: access.mfaSatisfied,
    ip: request?.ip ?? null,
    userAgent: request?.userAgent ?? null,
  };
}

/** Actor for scheduled jobs and sweepers. */
export function systemActor(): AuditActor {
  return { id: null, type: 'system', roles: [], organisationId: null, mfaSatisfied: false };
}
