import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import {
  requiresMfa,
  type ConsentScope,
  type Role,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { TokenService } from './token.service.js';

export interface Credentials {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  mfaRequired: boolean;
}

const SYSTEM_ACTOR: AuditActor = {
  id: null,
  type: 'system',
  roles: [],
  organisationId: null,
  mfaSatisfied: false,
};

/**
 * Registration, login, refresh rotation and consent (Phase 0 section 3.2).
 *
 * Every sensitive action here writes an audit event -- including the failures,
 * which are the ones an incident review actually needs.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    role?: Role;
  }): Promise<{ userId: string }> {
    assertPasswordPolicy(input.password);
    const email = input.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing !== null) {
      // Same shape and roughly the same cost as the success path: a registration
      // endpoint that answers differently is an account-enumeration oracle.
      throw new AppError('conflict', 'That email address cannot be registered.');
    }

    const role: Role = input.role ?? 'student';
    if (role !== 'student' && role !== 'guide') {
      throw AppError.forbidden('Staff accounts are provisioned by Modex, not self-registered.');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        roles: { create: { role } },
      },
      select: { id: true },
    });

    await this.audit.record({
      actor: SYSTEM_ACTOR,
      action: 'user.registered',
      objectType: 'user',
      objectId: user.id,
      metadata: { role },
    });

    return { userId: user.id };
  }

  async login(credentials: Credentials): Promise<IssuedSession> {
    const email = credentials.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        organisationId: true,
        mfaEnrolledAt: true,
        roles: { where: { revokedAt: null }, select: { role: true } },
      },
    });

    const passwordOk =
      user?.passwordHash != null && (await argon2.verify(user.passwordHash, credentials.password));

    if (user === null || !passwordOk || user.status !== 'active') {
      await this.audit.record({
        actor: {
          ...SYSTEM_ACTOR,
          ip: credentials.ip ?? null,
          userAgent: credentials.userAgent ?? null,
        },
        action: 'user.login_failed',
        objectType: 'user',
        objectId: user?.id ?? email,
        metadata: { reason: user === null ? 'unknown_account' : 'bad_credentials_or_inactive' },
      });
      throw new AppError('unauthenticated', 'Those credentials did not match.');
    }

    const roles = user.roles.map((grant) => grant.role as Role);
    const mfaRequired = requiresMfa(roles);
    if (mfaRequired && user.mfaEnrolledAt === null) {
      throw new AppError(
        'mfa_required',
        'This role requires multi-factor authentication. Enrol a device to continue.',
      );
    }

    // A staff session starts un-MFA-satisfied; the challenge upgrades it. Until
    // then the AuthGuard rejects it, so a half-finished login grants nothing.
    const session = await this.issueSession({
      userId: user.id,
      roles,
      organisationId: user.organisationId,
      mfaSatisfied: !mfaRequired,
      ip: credentials.ip ?? null,
      userAgent: credentials.userAgent ?? null,
    });

    await this.audit.record({
      actor: {
        id: user.id,
        type: 'user',
        roles,
        organisationId: user.organisationId,
        mfaSatisfied: !mfaRequired,
        ip: credentials.ip ?? null,
        userAgent: credentials.userAgent ?? null,
      },
      action: 'user.login_succeeded',
      objectType: 'user',
      objectId: user.id,
      metadata: { mfaRequired },
    });

    return { ...session, mfaRequired };
  }

  /**
   * Refresh rotation. Presenting a token that was already consumed revokes the
   * entire family: at that point the legitimate holder and an attacker are
   * indistinguishable, and the safe answer is that neither continues.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        revokedAt: true,
        expiresAt: true,
        mfaSatisfied: true,
        user: {
          select: {
            organisationId: true,
            status: true,
            roles: { where: { revokedAt: null }, select: { role: true } },
          },
        },
      },
    });

    if (session === null) {
      throw new AppError('unauthenticated', 'That refresh token is not valid.');
    }

    if (session.revokedAt !== null) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actor: { ...SYSTEM_ACTOR, id: session.userId },
        action: 'user.session_revoked',
        objectType: 'session',
        objectId: session.id,
        metadata: { reason: 'refresh_token_reuse', familyId: session.familyId },
      });
      throw new AppError('unauthenticated', 'That refresh token has already been used.');
    }

    if (session.expiresAt <= new Date() || session.user.status !== 'active') {
      throw new AppError('unauthenticated', 'This session is no longer valid.');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });

    return {
      ...(await this.issueSession({
        userId: session.userId,
        roles: session.user.roles.map((grant) => grant.role as Role),
        organisationId: session.user.organisationId,
        mfaSatisfied: session.mfaSatisfied,
        familyId: session.familyId,
        parentId: session.id,
      })),
      mfaRequired: false,
    };
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  async revokeSession(actor: AuditActor, userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw AppError.notFound('Session');

    await this.audit.record({
      actor,
      action: 'user.session_revoked',
      objectType: 'session',
      objectId: sessionId,
      metadata: { reason: 'user_requested' },
    });
  }

  async grantConsent(
    actor: AuditActor,
    userId: string,
    scope: ConsentScope,
    options: { subjectId?: string | null; noticeVersion: string; expiresAt?: Date | null },
  ): Promise<void> {
    await this.prisma.consentGrant.create({
      data: {
        userId,
        scope,
        subjectId: options.subjectId ?? null,
        noticeVersion: options.noticeVersion,
        expiresAt: options.expiresAt ?? null,
      },
    });
    await this.audit.record({
      actor,
      action: 'consent.granted',
      objectType: 'consent',
      objectId: `${userId}:${scope}`,
      metadata: { scope, subjectId: options.subjectId ?? null, noticeVersion: options.noticeVersion },
    });
  }

  async revokeConsent(actor: AuditActor, userId: string, scope: ConsentScope): Promise<void> {
    await this.prisma.consentGrant.updateMany({
      where: { userId, scope, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actor,
      action: 'consent.revoked',
      objectType: 'consent',
      objectId: `${userId}:${scope}`,
      metadata: { scope },
    });
  }

  private async issueSession(input: {
    userId: string;
    roles: Role[];
    organisationId: string | null;
    mfaSatisfied: boolean;
    familyId?: string;
    parentId?: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<Omit<IssuedSession, 'mfaRequired'>> {
    const refresh = this.tokens.mintRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: refresh.hash,
        familyId: input.familyId ?? randomUUID(),
        parentId: input.parentId ?? null,
        expiresAt: refresh.expiresAt,
        mfaSatisfied: input.mfaSatisfied,
        userAgent: input.userAgent ?? null,
        ipHash: input.ip == null ? null : hashIp(input.ip),
      },
      select: { id: true },
    });

    const accessToken = await this.tokens.issueAccessToken({
      sub: input.userId,
      roles: input.roles,
      organisationId: input.organisationId,
      mfa: input.mfaSatisfied,
      sid: session.id,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      expiresAt: refresh.expiresAt.toISOString(),
    };
  }
}

/**
 * Strong password policy (Phase 0 section 3.2). Length first, because length is
 * what actually resists offline attack; a composition rule that pushes people to
 * "Password1!" trades real entropy for the appearance of rigour.
 */
export function assertPasswordPolicy(password: string): void {
  const problems: string[] = [];
  if (password.length < 12) problems.push('be at least 12 characters');
  if (password.length > 256) problems.push('be no more than 256 characters');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    problems.push('mix upper and lower case');
  }
  if (!/\d/.test(password) && !/[^\w\s]/.test(password)) {
    problems.push('include a number or a symbol');
  }
  if (problems.length > 0) {
    throw AppError.validation('That password does not meet the policy.', [
      { field: 'password', code: 'weak_password', message: `Password must ${problems.join(', ')}.` },
    ]);
  }
}

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}
