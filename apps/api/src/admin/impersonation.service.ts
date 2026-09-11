import { Injectable } from '@nestjs/common';
import {
  IMPERSONATION_MAX_MINUTES,
  isImpersonationActive,
  type AccessContext,
  type ImpersonationRequest,
  type Role,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import { TokenService } from '../auth/token.service.js';

/**
 * Support impersonation (Phase 6 §3).
 *
 * Five properties, each of which is load-bearing and each of which is easy to
 * quietly lose:
 *
 * 1. **Controlled** — `user:impersonate`, held by ops alone.
 * 2. **Time-boxed** — a grant carries an expiry no longer than
 *    {@link IMPERSONATION_MAX_MINUTES}, and the session resolver re-reads it on
 *    every request, so ending one ends the access immediately.
 * 3. **Consented** — the subject holds an active `support_access` consent. Its
 *    own scope, because agreeing that a guide may read your profile is not
 *    agreeing that a member of staff may sit inside your account. Revoking it
 *    ends the visit on the next request.
 * 4. **Visible** — the grant is readable by its subject, which is what the
 *    student-facing banner and the Phase 7 "who has my data" view both read.
 * 5. **Audited** — start and end are both events, and every action taken during
 *    the window carries `impersonatedBy` in its own metadata.
 *
 * What impersonation is *not*: a way to gain permissions. The issued token
 * carries the subject's roles, so an operator impersonating a student can do
 * exactly what that student can do, and nothing else.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  async start(access: AccessContext, input: ImpersonationRequest) {
    if (input.subjectId === access.userId) {
      throw AppError.forbidden('You are already yourself.');
    }

    const subject = await this.prisma.user.findUnique({
      where: { id: input.subjectId },
      select: {
        id: true,
        status: true,
        organisationId: true,
        roles: { where: { revokedAt: null }, select: { role: true } },
      },
    });
    if (subject === null) throw AppError.notFound('That account');
    if (subject.status !== 'active') {
      throw new AppError('precondition_failed', 'That account is not active.');
    }

    // Staff accounts are out of scope, and deliberately: impersonating an
    // administrator is privilege escalation wearing a support ticket.
    const roles = subject.roles.map((grant) => grant.role as Role);
    if (roles.some((role) => role !== 'student' && role !== 'guide')) {
      throw AppError.forbidden('Only student and guide accounts can be supported this way.');
    }

    // Consent, checked against the subject's own grants — never against
    // something the operator asserts in the request.
    const consent = await this.prisma.consentGrant.findFirst({
      where: {
        userId: subject.id,
        scope: 'support_access',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, grantedAt: true },
    });
    if (consent === null) {
      throw new AppError(
        'consent_missing',
        'This account has not agreed to support access. Ask them to turn it on from their privacy settings.',
      );
    }

    const existing = await this.prisma.impersonationGrant.findFirst({
      where: { subjectId: input.subjectId, endedAt: null, expiresAt: { gt: new Date() } },
    });
    if (existing !== null) {
      throw new AppError('conflict', 'Another operator is already in this account.');
    }

    const minutes = Math.min(input.minutes, IMPERSONATION_MAX_MINUTES);
    const correlationId = currentContext()?.correlationId ?? 'admin';
    const grant = await this.prisma.impersonationGrant.create({
      data: {
        operatorId: access.userId,
        subjectId: input.subjectId,
        reason: input.reason,
        reference: input.reference,
        correlationId,
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
    });

    // A session row of its own, so the student can see it in their device list
    // and cut it off themselves — the same list, the same button.
    const session = await this.prisma.session.create({
      data: {
        userId: subject.id,
        refreshTokenHash: `impersonation:${grant.id}`,
        familyId: grant.id,
        expiresAt: grant.expiresAt,
        mfaSatisfied: true,
        userAgent: `Modex support (operator ${access.userId})`,
      },
      select: { id: true },
    });

    const accessToken = await this.tokens.issueAccessToken({
      sub: subject.id,
      roles,
      organisationId: subject.organisationId,
      mfa: true,
      sid: session.id,
      act: access.userId,
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'impersonation.started',
      objectType: 'user',
      objectId: subject.id,
      correlationId,
      metadata: {
        grantId: grant.id,
        reason: input.reason,
        reference: input.reference,
        expiresAt: grant.expiresAt.toISOString(),
        minutes,
        consentId: consent.id,
      },
    });

    return {
      grantId: grant.id,
      subjectId: subject.id,
      expiresAt: grant.expiresAt.toISOString(),
      /**
       * Returned once. There is no endpoint that re-reads it: an impersonation
       * token that can be fetched again is an impersonation that outlives the
       * conversation it was granted for.
       */
      accessToken,
    };
  }

  async end(access: AccessContext, grantId: string, reason = 'ended_by_operator') {
    const grant = await this.prisma.impersonationGrant.findUnique({ where: { id: grantId } });
    if (grant === null) throw AppError.notFound('That support session');
    if (grant.endedAt !== null) return { ended: true, alreadyEnded: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.impersonationGrant.update({
        where: { id: grantId },
        data: { endedAt: new Date(), endedReason: reason },
      });
      await tx.session.updateMany({
        where: { familyId: grantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'impersonation.ended',
      objectType: 'user',
      objectId: grant.subjectId,
      metadata: { grantId, reason },
    });

    return { ended: true, alreadyEnded: false };
  }

  /** Grants the operator can see: everything currently open. */
  async active(now: Date = new Date()) {
    const grants = await this.prisma.impersonationGrant.findMany({
      where: { endedAt: null, expiresAt: { gt: now } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return grants.filter((grant) => isImpersonationActive(grant, now));
  }

  /**
   * The subject's own view. Every grant, ever — not just the open ones.
   *
   * "The student sees that it happened" is past tense on purpose: a banner that
   * disappears when the session ends would let a support visit the student
   * never noticed become a support visit that, as far as they can tell, never
   * happened.
   */
  async forSubject(subjectId: string) {
    return this.prisma.impersonationGrant.findMany({
      where: { subjectId },
      orderBy: { startedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        reason: true,
        reference: true,
        startedAt: true,
        expiresAt: true,
        endedAt: true,
        endedReason: true,
        operatorId: true,
      },
    });
  }

  /**
   * Closes grants whose window has passed.
   *
   * The expiry is already enforced on every request, so this sweep is not what
   * makes impersonation safe — it is what keeps the console's "active" list
   * honest and gives the audit log an explicit end event for every start.
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.impersonationGrant.findMany({
      where: { endedAt: null, expiresAt: { lte: now } },
      select: { id: true, subjectId: true, operatorId: true },
    });

    for (const grant of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.impersonationGrant.update({
          where: { id: grant.id },
          data: { endedAt: now, endedReason: 'expired' },
        });
        await tx.session.updateMany({
          where: { familyId: grant.id, revokedAt: null },
          data: { revokedAt: now },
        });
      });
      await this.audit.record({
        actor: { id: null, type: 'system', roles: [], organisationId: null, mfaSatisfied: false },
        action: 'impersonation.expired',
        objectType: 'user',
        objectId: grant.subjectId,
        metadata: { grantId: grant.id, operatorId: grant.operatorId },
      });
    }

    return expired.length;
  }
}
