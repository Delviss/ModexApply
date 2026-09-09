import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { redactAuditMetadata, type AuditAction } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentContext } from '../common/observability/request-context.js';
import { GENESIS_INTEGRITY_REF, computeIntegrityRef, verifyChain } from './integrity.js';

export interface AuditActor {
  id: string | null;
  type: 'user' | 'system' | 'connector';
  roles: string[];
  organisationId: string | null;
  mfaSatisfied: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordAuditInput {
  actor: AuditActor;
  action: AuditAction;
  objectType: string;
  objectId: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * The audit spine (Phase 0 section 3.3).
 *
 * Writing an audit event is the easy path -- one call, no ceremony -- and there
 * is no method here that updates or removes one. Metadata is redacted *before*
 * the write, so a secret that slips into a call site never reaches storage in
 * the first place.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<{ id: string; integrityRef: string }> {
    const correlationId = input.correlationId ?? currentContext()?.correlationId ?? 'system';
    const metadata = redactAuditMetadata(input.metadata ?? {});
    const timestamp = new Date();

    // The chain has to be built against the true tail, so the read and the write
    // are one serialisable transaction. Contention here is acceptable: audit
    // writes are not on the hot path of any read.
    return this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.auditEvent.findFirst({
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          select: { integrityRef: true },
        });

        const integrityRef = computeIntegrityRef(
          {
            actorId: input.actor.id,
            actorType: input.actor.type,
            action: input.action,
            objectType: input.objectType,
            objectId: input.objectId,
            timestamp,
            correlationId,
            metadata,
          },
          previous?.integrityRef ?? GENESIS_INTEGRITY_REF,
        );

        return tx.auditEvent.create({
          data: {
            actorId: input.actor.id,
            actorType: input.actor.type,
            action: input.action,
            objectType: input.objectType,
            objectId: input.objectId,
            timestamp,
            correlationId,
            integrityRef,
            metadata: metadata as object,
            authContext: {
              roles: input.actor.roles,
              organisationId: input.actor.organisationId,
              mfaSatisfied: input.actor.mfaSatisfied,
              ipHash: input.actor.ip == null ? null : hashIp(input.actor.ip),
              userAgent: input.actor.userAgent ?? null,
            },
          },
          select: { id: true, integrityRef: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  /** Reads the trail for one object. Trust and ops surfaces only. */
  async trailFor(objectType: string, objectId: string) {
    return this.prisma.auditEvent.findMany({
      where: { objectType, objectId },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Verifies the whole chain. Run on a schedule; a break is a security incident,
   * not a bug report.
   */
  async verifyIntegrity(): Promise<{ valid: boolean; brokenAtId: string | null; checked: number }> {
    const events = await this.prisma.auditEvent.findMany({
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    const result = verifyChain(
      events.map((event) => ({
        id: event.id,
        actorId: event.actorId,
        actorType: event.actorType,
        action: event.action,
        objectType: event.objectType,
        objectId: event.objectId,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        metadata: event.metadata,
        integrityRef: event.integrityRef,
      })),
    );
    if (!result.valid) {
      this.logger.error(`Audit chain broken at event ${result.brokenAtId}`);
    }
    return { ...result, checked: events.length };
  }
}

/** IP addresses are personal data; the audit row keeps a hash, not the address. */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
