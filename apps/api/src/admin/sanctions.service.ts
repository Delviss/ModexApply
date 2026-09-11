import { Injectable } from '@nestjs/common';
import {
  canReverse,
  silencesGuide,
  type AccessContext,
  type SanctionInput,
  type SanctionKind,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import { GuidesService } from '../guides/guides.service.js';

/**
 * Sanctions (Phase 6 §2): warn, restrict, suspend, ban — each with a reason
 * code, an actor and a reversal path.
 *
 * The rule that shapes this service is the last one: **a sanction must take
 * effect everywhere it means something, and lifting it must be possible.**
 * Writing a row that says "suspended" while the guide is still in the directory
 * and still answering messages is not a sanction, it is a note. So applying one
 * calls through to the same `GuidesService` methods the Phase 3 flows use, in
 * the same transaction shape, and the row here is the durable record of *why*.
 *
 * Nothing is ever deleted. A reversal writes `reversedAt` on the existing row
 * and produces its own audit event, so "was this person ever suspended, and who
 * lifted it" survives the lifting.
 */
@Injectable()
export class SanctionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guides: GuidesService,
  ) {}

  async apply(access: AccessContext, input: SanctionInput) {
    const correlationId = currentContext()?.correlationId ?? 'admin';
    await this.assertTargetExists(input.targetType, input.targetId);

    const sanction = await this.prisma.sanction.create({
      data: {
        targetType: input.targetType,
        targetId: input.targetId,
        kind: input.kind,
        reasonCode: input.reasonCode,
        reason: input.reason,
        caseId: input.caseId,
        actorId: access.userId,
        correlationId,
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
      },
    });

    const effects = await this.enforce(access, input.targetType, input.targetId, input.kind, input.reason);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'sanction.applied',
      objectType: input.targetType,
      objectId: input.targetId,
      correlationId,
      metadata: {
        sanctionId: sanction.id,
        kind: input.kind,
        reasonCode: input.reasonCode,
        reason: input.reason,
        caseId: input.caseId,
        impersonatedBy: access.impersonatedBy,
        effects,
      },
    });

    return { ...sanction, effects };
  }

  /**
   * Lifts a sanction.
   *
   * A `ban` is reversible for the same reason every other kind is: the platform
   * that cannot undo a mistake has decided its false positives are permanent.
   */
  async reverse(access: AccessContext, sanctionId: string, reason: string) {
    const sanction = await this.prisma.sanction.findUnique({ where: { id: sanctionId } });
    if (sanction === null) throw AppError.notFound('Sanction');
    if (!canReverse(sanction)) {
      throw new AppError('conflict', 'This sanction has already been lifted.');
    }

    const updated = await this.prisma.sanction.update({
      where: { id: sanctionId },
      data: { reversedAt: new Date(), reversedBy: access.userId, reversalReason: reason },
    });

    const effects = await this.unenforce(access, sanction.targetType, sanction.targetId, sanction.kind);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'sanction.reversed',
      objectType: sanction.targetType,
      objectId: sanction.targetId,
      metadata: { sanctionId, reason, kind: sanction.kind, effects },
    });

    return { ...updated, effects };
  }

  /** Live sanctions on one target: unreversed, and not past their own expiry. */
  async activeFor(targetType: SanctionInput['targetType'], targetId: string, now = new Date()) {
    return this.prisma.sanction.findMany({
      where: {
        targetType,
        targetId,
        reversedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { appliedAt: 'desc' },
    });
  }

  async list(filters: { targetType?: SanctionInput['targetType']; active?: boolean } = {}) {
    const now = new Date();
    return this.prisma.sanction.findMany({
      where: {
        ...(filters.targetType === undefined ? {} : { targetType: filters.targetType }),
        ...(filters.active === true
          ? { reversedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
          : {}),
      },
      orderBy: { appliedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Makes the sanction real.
   *
   * `warn` deliberately changes no state: it is a recorded notice, and treating
   * it as a silent restriction would mean the guide is punished by a mechanism
   * nobody told them about.
   */
  private async enforce(
    access: AccessContext,
    targetType: SanctionInput['targetType'],
    targetId: string,
    kind: SanctionKind,
    reason: string,
  ): Promise<Record<string, unknown>> {
    if (targetType === 'guide') {
      if (silencesGuide(kind)) {
        return { guide: await this.guides.suspend(toAuditActor(access), targetId, reason) };
      }
      if (kind === 'restrict') {
        return { guide: await this.guides.restrict(toAuditActor(access), targetId, reason) };
      }
      return { guide: 'warned' };
    }

    if (targetType === 'user' && silencesGuide(kind)) {
      await this.prisma.user.update({ where: { id: targetId }, data: { status: 'suspended' } });
      // Every session, not just the current one: an access token already issued
      // would otherwise keep working for up to its full lifetime.
      const sessions = await this.prisma.session.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { accountSuspended: true, sessionsRevoked: sessions.count };
    }

    if (targetType === 'offer' && kind !== 'warn') {
      await this.prisma.offer.updateMany({
        where: { id: targetId, publicationState: 'published' },
        data: {
          publicationState: 'unpublished',
          unpublishedAt: new Date(),
          unpublishedReason: reason,
        },
      });
      return { offerUnpublished: true };
    }

    if (targetType === 'institution' && kind === 'ban') {
      await this.prisma.institutionPartnership.updateMany({
        where: { institutionId: targetId, status: 'active' },
        data: { status: 'suspended' },
      });
      return { partnershipSuspended: true };
    }

    return { recorded: true };
  }

  private async unenforce(
    access: AccessContext,
    targetType: SanctionInput['targetType'],
    targetId: string,
    kind: SanctionKind,
  ): Promise<Record<string, unknown>> {
    if (targetType === 'guide' && kind !== 'warn') {
      // Back to `active` rather than to whatever the state was before: a guide
      // whose evidence expired while suspended must not be restored to a
      // verified-looking state by a reversal. The reverification sweep owns
      // that decision and will restrict them again within the hour if it holds.
      const guide = await this.prisma.studentGuide.update({
        where: { id: targetId },
        data: {
          state: 'active',
          suspendedAt: null,
          suspensionReason: null,
          restrictedAt: null,
        },
        select: { id: true, state: true, evidenceExpiresAt: true },
      });
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'guide.reinstated',
        objectType: 'guide',
        objectId: targetId,
        metadata: { evidenceExpiresAt: guide.evidenceExpiresAt },
      });
      return { guide: guide.state };
    }

    if (targetType === 'user' && silencesGuide(kind)) {
      await this.prisma.user.update({ where: { id: targetId }, data: { status: 'active' } });
      return { accountRestored: true };
    }

    return { recorded: true };
  }

  /**
   * A sanction against a target that does not exist is a typo with an audit
   * trail. Checked before the row is written, not after.
   */
  private async assertTargetExists(
    targetType: SanctionInput['targetType'],
    targetId: string,
  ): Promise<void> {
    const found =
      targetType === 'guide'
        ? await this.prisma.studentGuide.findUnique({ where: { id: targetId }, select: { id: true } })
        : targetType === 'user'
          ? await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })
          : targetType === 'offer'
            ? await this.prisma.offer.findUnique({ where: { id: targetId }, select: { id: true } })
            : await this.prisma.institution.findUnique({
                where: { id: targetId },
                select: { id: true },
              });
    if (found === null) throw AppError.notFound('The target of this sanction');
  }
}
