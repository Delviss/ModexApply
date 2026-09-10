import { Injectable } from '@nestjs/common';
import {
  canTransitionCase,
  type AccessContext,
  type ReportInput,
  type ReportableTargetType,
  type RiskSeverity,
  type TrustCaseState,
  type TrustCaseType,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import type { Prisma } from '@prisma/client';

export interface OpenCaseInput {
  type: TrustCaseType;
  reporterId: string | null;
  targetType: ReportableTargetType;
  targetId: string;
  severity: RiskSeverity;
  summary: string;
  description?: string | null;
  /** Pre-set state, for a case opened alongside evidence already preserved. */
  state?: TrustCaseState;
}

/**
 * Trust cases (Phase 3 §4, FR-015).
 *
 * **Any** user can report **any** person, offer, institutional claim or message,
 * and the report always produces a case — there is no path here that decides a
 * report is not worth recording. Triage decides that, afterwards, in public
 * view of the audit log.
 *
 * Cases opened by the platform itself (a risk rule firing) and cases opened by a
 * person go through the same method and land in the same table. A queue where
 * automatic cases look different from human ones is a queue where one of the two
 * gets ignored.
 */
@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Opens a case. `tx` is accepted so a case can be opened in the same
   * transaction that preserves the evidence it is about — the two must not be
   * able to come apart.
   */
  async openCase(
    actor: AuditActor,
    input: OpenCaseInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; state: TrustCaseState }> {
    const client = tx ?? this.prisma;
    const correlationId = currentContext()?.correlationId ?? 'system';

    const trustCase = await client.trustCase.create({
      data: {
        type: input.type,
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        severity: input.severity,
        summary: input.summary,
        description: input.description ?? null,
        state: input.state ?? 'open',
        correlationId,
      },
      select: { id: true, state: true },
    });

    await client.trustCaseEvent.create({
      data: {
        caseId: trustCase.id,
        fromState: null,
        toState: trustCase.state,
        note: input.summary,
        actorId: input.reporterId,
      },
    });

    await this.audit.record({
      actor,
      action: 'trust_case.opened',
      objectType: 'trust_case',
      objectId: trustCase.id,
      metadata: {
        type: input.type,
        targetType: input.targetType,
        targetId: input.targetId,
        severity: input.severity,
        reportedByUser: input.reporterId !== null,
      },
    });

    return trustCase;
  }

  /**
   * A report from a person (FR-015).
   *
   * Deliberately available to every authenticated role, and deliberately not
   * scoped to a relationship: a student who saw something in a public Q&A answer
   * can report it without having messaged anyone.
   */
  async report(access: AccessContext, input: ReportInput) {
    const severity: RiskSeverity =
      input.type === 'payment_solicitation' || input.type === 'impersonation' ? 'high' : 'medium';

    const trustCase = await this.openCase(toAuditActor(access), {
      type: input.type,
      reporterId: access.userId,
      targetType: input.targetType,
      targetId: input.targetId,
      severity,
      summary: `Reported by a user: ${input.type.replace(/_/g, ' ')}`,
      description: input.description,
    });

    // The reporter is told in the thread that a human is now involved, so the
    // report does not feel like shouting into a void.
    if (input.targetType === 'message' || input.targetType === 'conversation') {
      const conversationId =
        input.targetType === 'conversation'
          ? input.targetId
          : ((
              await this.prisma.message.findUnique({
                where: { id: input.targetId },
                select: { conversationId: true },
              })
            )?.conversationId ?? null);

      if (conversationId !== null) {
        await this.prisma.message.create({
          data: {
            conversationId,
            senderId: null,
            senderRole: 'system',
            kind: 'system',
            systemKind: 'report_submitted',
            body: 'A report was sent to Modex Trust. Somebody will look at this conversation; you do not need to do anything else.',
          },
        });
      }
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'message.reported',
      objectType: input.targetType,
      objectId: input.targetId,
      metadata: { caseId: trustCase.id, type: input.type },
    });

    return { caseId: trustCase.id, state: trustCase.state };
  }

  /** Moves a case along. Trust only; the state machine refuses the rest. */
  async transition(
    access: AccessContext,
    caseId: string,
    toState: TrustCaseState,
    note?: string,
  ) {
    const trustCase = await this.prisma.trustCase.findUnique({ where: { id: caseId } });
    if (trustCase === null) throw AppError.notFound('Trust case');

    if (!canTransitionCase(trustCase.state, toState)) {
      throw AppError.stateTransition(
        `A ${trustCase.state} case cannot move to ${toState}.`,
        { from: trustCase.state, to: toState },
      );
    }

    const closing = toState === 'actioned' || toState === 'dismissed';
    await this.prisma.$transaction([
      this.prisma.trustCase.update({
        where: { id: caseId },
        data: { state: toState, ...(closing ? { closedAt: new Date() } : {}) },
      }),
      this.prisma.trustCaseEvent.create({
        data: {
          caseId,
          fromState: trustCase.state,
          toState,
          note: note ?? null,
          actorId: access.userId,
        },
      }),
    ]);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'trust_case.transitioned',
      objectType: 'trust_case',
      objectId: caseId,
      metadata: { from: trustCase.state, to: toState, note },
    });

    return { id: caseId, state: toState };
  }

  async list(filters: { state?: TrustCaseState; targetId?: string } = {}) {
    return this.prisma.trustCase.findMany({
      where: {
        ...(filters.state === undefined ? {} : { state: filters.state }),
        ...(filters.targetId === undefined ? {} : { targetId: filters.targetId }),
      },
      orderBy: [{ severity: 'desc' }, { openedAt: 'desc' }],
      take: 100,
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /**
   * One case, with its evidence.
   *
   * The flags are fetched separately rather than joined, because
   * `message_flags` deliberately holds no foreign key to anything: evidence
   * outlives the message and the case it refers to, and a foreign key would make
   * it a hostage of both.
   */
  async detail(caseId: string) {
    const trustCase = await this.prisma.trustCase.findUnique({
      where: { id: caseId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (trustCase === null) throw AppError.notFound('Trust case');

    const flags = await this.prisma.messageFlag.findMany({
      where: { trustCaseId: caseId },
      orderBy: { createdAt: 'asc' },
    });

    return { ...trustCase, flags };
  }

  /**
   * Whether a guide has an unresolved case against them.
   *
   * Used by the reward ledger to withhold — never to approve. A guide with no
   * case is not thereby approved; approval is a finance decision in #8.
   */
  async hasOpenCase(guideId: string): Promise<boolean> {
    const count = await this.prisma.trustCase.count({
      where: {
        targetType: 'guide',
        targetId: guideId,
        state: { in: ['open', 'triaging', 'evidence_preserved', 'escalated'] },
      },
    });
    return count > 0;
  }
}
