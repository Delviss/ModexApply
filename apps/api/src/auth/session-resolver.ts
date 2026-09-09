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
      select: { id: true, userId: true, revokedAt: true, expiresAt: true, mfaSatisfied: true },
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

    return buildAccessContext({
      userId: user.id,
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
}
