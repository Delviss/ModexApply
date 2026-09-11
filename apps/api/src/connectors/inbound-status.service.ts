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
import { OfferLifecycleService } from '../offers/offer-lifecycle.service.js';
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
    private readonly offers: OfferLifecycleService,
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

    // Phase 5. Two events carry offer consequences, and both are recorded from
    // the partner's own event rather than from anything a student typed.
    //
    // Both are wrapped, and the wrapping is the point: the state transition
    // above has already committed and the event is already stored, so throwing
    // here would answer the partner with a 500 for a delivery that *worked* —
    // and their retry would then hit a state that has already moved. An offer
    // consequence we could not record is a logged failure to chase, never a
    // reason to tell a university their event failed.
    if (event.kind === 'offer_made') {
      try {
        // The university's admission decision — kept in its own table, with its
        // own vocabulary. It is emphatically not a scholarship.
        await this.offers.recordAdmissionOffer(
          { ...systemActor(), type: 'connector' },
          application.id,
          {
            kind: readAdmissionKind(event.detail),
            conditions: readAdmissionConditions(event.detail),
            issuedAt: event.occurredAt,
            respondByAt: readRespondBy(event.detail),
            externalRef: event.externalRef,
            notes: readDetailMessage(event.detail),
          },
        );
      } catch (error) {
        this.logger.error(
          `Could not record the admission offer on application ${application.id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    if (event.kind === 'enrolled') {
      try {
        // The one place `realisedAt` is written. "Savings secured" counts this,
        // so it has to come from the university saying the student enrolled —
        // never from the student accepting an award they went on not to use.
        const realised = await this.offers.realiseAtEnrolment(
          application.id,
          new Date(event.occurredAt),
        );
        if (realised > 0) {
          this.logger.log(
            `Realised ${realised} offer(s) on application ${application.id} at enrolment`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Could not realise offers on application ${application.id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
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

/**
 * The admission offer, read out of the partner's event.
 *
 * Conservative on purpose: an offer whose conditions we cannot read is recorded
 * as **conditional with no conditions listed**, never as unconditional. Guessing
 * "unconditional" from an unparseable payload would tell a student they have a
 * confirmed place on the strength of a field we did not understand.
 */
function readAdmissionKind(detail: Record<string, unknown>): 'conditional' | 'unconditional' {
  const kind = detail.offerKind ?? detail.kind ?? detail.offerType;
  return kind === 'unconditional' ? 'unconditional' : 'conditional';
}

function readAdmissionConditions(
  detail: Record<string, unknown>,
): { summary: string; met: boolean; evidence: string | null }[] {
  const raw = detail.conditions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    // `>= 3` rather than `!== ''`, to match `AdmissionConditionSchema`: a reader
    // that is laxer than the schema it feeds turns a partner's typo into a throw.
    if (typeof entry === 'string' && entry.trim().length >= 3) {
      return [{ summary: entry.trim(), met: false, evidence: null }];
    }
    if (entry !== null && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      if (summary.length < 3) return [];
      return [
        {
          summary,
          met: record.met === true,
          evidence: typeof record.evidence === 'string' ? record.evidence : null,
        },
      ];
    }
    return [];
  });
}

function readRespondBy(detail: Record<string, unknown>): string | null {
  const value = detail.respondBy ?? detail.respondByAt ?? detail.deadline;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
