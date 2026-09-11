import { Injectable } from '@nestjs/common';
import type { AccessContext, ConsentGrant, Role } from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from '../common/errors/app-error.js';
import { TokenService } from './token.service.js';
import { buildAccessContext } from './access-context.js';

/**
 * Turns a bearer token into an access context.
 *
 * The token carries roles for speed, but the session and the user's status are
 * re-read on every request: a revoked session or a suspended account has to stop
 * working immediately, not when a fifteen-minute access token happens to expire.
 */
@Injectable()
export class SessionResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async resolve(accessToken: string): Promise<AccessContext> {
    const claims = await this.tokens.verifyAccessToken(accessToken);

    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        mfaSatisfied: true,
        stepUpAt: true,
      },
    });
    if (session === null || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new AppError('unauthenticated', 'This session is no longer valid.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        status: true,
        organisationId: true,
        roles: { where: { revokedAt: null }, select: { role: true } },
        consents: {
          select: {
            scope: true,
            subjectId: true,
            grantedAt: true,
            expiresAt: true,
            revokedAt: true,
          },
        },
      },
    });
    if (user === null || user.status !== 'active') {
      throw new AppError('unauthenticated', 'This account is not active.');
    }

    // An impersonation session carries the operator in the token's `act` claim;
    // the grant is re-read here rather than trusted from the token, so ending a
    // grant early ends the access on the very next request.
    const impersonatedBy = await this.activeImpersonator(claims, session.userId);

    return buildAccessContext({
      userId: user.id,
      sessionId: session.id,
      stepUpAt: session.stepUpAt,
      impersonatedBy,
      roles: user.roles.map((grant) => grant.role as Role),
      organisationId: user.organisationId,
      mfaSatisfied: session.mfaSatisfied,
      consents: user.consents.map(
        (consent): ConsentGrant => ({
          scope: consent.scope,
          subjectId: consent.subjectId,
          grantedAt: consent.grantedAt.toISOString(),
          expiresAt: consent.expiresAt?.toISOString() ?? null,
          revokedAt: consent.revokedAt?.toISOString() ?? null,
        }),
      ),
    });
  }

  /**
   * Resolves the operator behind an impersonation session, or null.
   *
   * A token claiming an impersonation that has expired or been ended is not an
   * error — it is simply no longer an impersonation, and the session it belongs
   * to is rejected outright: continuing as the subject without the marker would
   * be exactly the untraceable access the grant exists to prevent.
   */
  private async activeImpersonator(
    claims: { act?: string | null },
    subjectId: string,
  ): Promise<string | null> {
    if (claims.act == null) return null;
    const grant = await this.prisma.impersonationGrant.findFirst({
      where: {
        operatorId: claims.act,
        subjectId,
        endedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { operatorId: true },
    });
    if (grant === null) {
      throw new AppError('unauthenticated', 'This support session has ended.');
    }
    return grant.operatorId;
  }
}
