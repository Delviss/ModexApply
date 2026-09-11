import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  InboundStatusEventSchema,
  canTransition,
  stateForInboundStatus,
  type ApplicationState,
  type InboundStatusEvent,
} from '@modex/contracts';
import { verifyWebhook } from '../common/crypto/webhook-signature.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import { ApplicationStateService } from '../applications/application-state.service.js';
import { SECRET_RESOLVER, type SecretResolver } from './connector.port.js';

export interface InboundResult {
  accepted: boolean;
  applied: boolean;
  reason: string | null;
}

/**
 * Inbound status from a university (Phase 4 §3).
 *
 * Three guarantees, and they are separate:
 *
 *  1. **Signed.** An unsigned or badly-signed event is refused before anything
 *     is read from it, and the refusal is audited — a stream of bad signatures
 *     on a partner's endpoint is a security signal, not a parsing problem.
 *  2. **Idempotent.** `(connectorId, providerEventId)` is unique in the
 *     database, so a partner's at-least-once delivery cannot apply anything
 *     twice even if two copies arrive concurrently.
 *  3. **Replay-safe.** The signature covers a timestamp inside a five-minute
 *     window, so a captured request stops working. The unique index alone would
 *     not do this: an attacker replaying a genuine old event under a *new* id
 *     would slip through.
 *
 * And one rule about storage: **every valid event is written**, including the
 * ones that change nothing. A student disputing a decision needs the whole
 * sequence, not the subset we acted on.
 */
@Injectable()
export class InboundStatusService {
  private readonly logger = new Logger(InboundStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly state: ApplicationStateService,
    @Inject(SECRET_RESOLVER) private readonly secrets: SecretResolver,
  ) {}

  /** The webhook path: verify the signature over the raw body, then apply. */
  async receiveSigned(
    connectorId: string,
    rawBody: string,
    headers: { signature: string | undefined; timestamp: string | undefined },
    now: Date = new Date(),
  ): Promise<InboundResult> {
    const connector = await this.prisma.connectorConfig.findUnique({ where: { id: connectorId } });
    if (connector === null) {
      // A 404 without confirming whether the id exists: an unauthenticated
      // endpoint must not be an oracle for valid connector ids.
      throw AppError.notFound('Connector');
    }

    const secret = this.secrets.resolve(connector.signingSecretRef);
    if (secret === null) {
      this.logger.error(`Connector ${connectorId} has no signing secret configured`);
      throw new AppError('dependency_unavailable', 'This endpoint is not accepting events.');
    }

    const verification = verifyWebhook(
      secret,
      headers.timestamp ?? '',
      rawBody,
      headers.signature ?? '',
      now,
    );
    if (!verification.valid) {
      await this.audit.record({
        actor: { ...systemActor(), type: 'connector' },
        action: 'connector.event_rejected',
        objectType: 'connector',
        objectId: connectorId,
        metadata: { reason: verification.reason, bodyBytes: rawBody.length },
      });
      throw AppError.forbidden('The event signature did not verify.');
    }

    let parsed: InboundStatusEvent;
    try {
      parsed = InboundStatusEventSchema.parse(JSON.parse(rawBody));
    } catch {
      await this.audit.record({
        actor: { ...systemActor(), type: 'connector' },
        action: 'connector.event_rejected',
        objectType: 'connector',
        objectId: connectorId,
        metadata: { reason: 'unparseable' },
      });
      throw AppError.validation('The event body is not a status event.', [
        { field: 'body', code: 'invalid', message: 'Unrecognised event shape.' },
      ]);
    }

    return this.apply(connectorId, parsed, now);
  }

  /**
   * Applies one event. Shared by the webhook and the poll job, because an event
   * discovered by polling deserves exactly the same treatment as one pushed.
   */
  async apply(
    connectorId: string,
    event: InboundStatusEvent,
    now: Date = new Date(),
  ): Promise<InboundResult> {
    const correlationId = currentContext()?.correlationId ?? 'system';

    const application = await this.locate(connectorId, event);

    const target = stateForInboundStatus(event.kind);
    const from = application?.state as ApplicationState | undefined;

    // Decided before the write so the stored row records the decision, not a
    // guess reconstructed later.
    const skippedReason =
      application === null
        ? 'no application carries this reference'
        : from !== undefined && from === target
          ? 'the application is already in this state'
          : from !== undefined && !canTransition(from, target)
            ? `an application cannot go from ${from} to ${target}`
            : null;

    let stored;
    try {
      stored = await this.prisma.applicationStatusEvent.create({
        data: {
          applicationId: application?.id ?? null,
          connectorId,
          providerEventId: event.providerEventId,
          externalRef: event.externalRef,
          kind: event.kind,
          occurredAt: new Date(event.occurredAt),
          receivedAt: now,
          detail: event.detail as object,
          applied: false,
          skippedReason,
          correlationId,
        },
      });
    } catch {
      // The unique index caught a duplicate delivery. Not an error: the partner
      // did what at-least-once delivery says it may do.
      return { accepted: true, applied: false, reason: 'duplicate event' };
    }

    await this.audit.record({
      actor: { ...systemActor(), type: 'connector' },
      action: 'connector.event_received',
      objectType: application === null ? 'connector' : 'application',
      objectId: application?.id ?? connectorId,
      correlationId,
      metadata: {
        providerEventId: event.providerEventId,
        kind: event.kind,
        externalRef: event.externalRef,
        skippedReason,
      },
    });

    if (application === null || skippedReason !== null) {
      return { accepted: true, applied: false, reason: skippedReason };
    }

    try {
      await this.state.transition({
        applicationId: application.id,
        to: target,
        actor: { ...systemActor(), type: 'connector' },
        authority: 'university',
        data: {
          currentOwner: target === 'more_info' ? 'student' : 'university',
          ...(target === 'submitted'
            ? {
                confirmedAt: new Date(event.occurredAt),
                // For an asynchronous connector this event *is* the receipt,
                // and it is the first time we learn the university's own
                // reference. Writing it here is what turns "Sending to …" into
                // "Submitted · confirmed by …" with something to show for it.
                externalRef: event.externalRef,
              }
            : {}),
        },
        metadata: { providerEventId: event.providerEventId, kind: event.kind },
      });
    } catch (error) {
      // A race with another event that moved the application first. The event
      // stays stored and says why it did not apply, rather than disappearing or
      // taking the partner's delivery down with a 500.
      const reason = error instanceof Error ? error.message : 'the transition was refused';
      await this.prisma.applicationStatusEvent.update({
        where: { id: stored.id },
        data: { skippedReason: reason },
      });
      this.logger.warn(
        `Event ${event.providerEventId} did not apply to application ${application.id}: ${reason}`,
      );
      return { accepted: true, applied: false, reason };
    }

    await this.prisma.applicationStatusEvent.update({
      where: { id: stored.id },
      data: { applied: true },
    });

    if (target === 'more_info') {
      await this.prisma.applicationTask.create({
        data: {
          applicationId: application.id,
          owner: 'student',
          type: 'provide_more_info',
          title: 'The university has asked for more information',
          detail: readDetailMessage(event.detail),
        },
      });
      await this.audit.record({
        actor: { ...systemActor(), type: 'connector' },
        action: 'application.task_created',
        objectType: 'application',
        objectId: application.id,
        correlationId,
        metadata: { type: 'provide_more_info' },
      });
    }

    await this.audit.record({
      actor: { ...systemActor(), type: 'connector' },
      action: 'application.status_received',
      objectType: 'application',
      objectId: application.id,
      correlationId,
      metadata: { kind: event.kind, from, to: target },
    });

    return { accepted: true, applied: true, reason: null };
  }
  /**
   * Finds the application an event belongs to.
   *
   * Two ways, in order. Normally the partner quotes their own reference, which
   * we stored when they gave it to us. But an asynchronous connector's *first*
   * event is the one that tells us what their reference is — so it cannot also
   * be the key we look the application up by. For those, the partner quotes
   * back the token we put in their continuation URL or package, which the
   * submission attempt recorded as evidence.
   */
  private async locate(connectorId: string, event: InboundStatusEvent) {
    const byExternalRef = await this.prisma.application.findFirst({
      where: { externalRef: event.externalRef, connectorId },
    });
    if (byExternalRef !== null) return byExternalRef;
    if (event.modexRef === undefined) return null;

    const attempt = await this.prisma.submissionAttempt.findFirst({
      where: {
        connectorId,
        OR: [
          { responseBody: { path: ['handoffRef'], equals: event.modexRef } },
          { responseBody: { path: ['batchRef'], equals: event.modexRef } },
        ],
      },
      orderBy: { attemptNo: 'desc' },
    });
    if (attempt === null) return null;

    return this.prisma.application.findFirst({
      where: { id: attempt.applicationId, connectorId },
    });
  }
}

/** The partner's own wording, when they sent one. Never invented. */
function readDetailMessage(detail: Record<string, unknown>): string {
  const message = detail.message ?? detail.reason ?? detail.note;
  return typeof message === 'string' && message.trim() !== ''
    ? message.trim()
    : 'Open the application to see what the university has asked for.';
}
