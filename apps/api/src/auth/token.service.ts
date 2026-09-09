import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@modex/contracts';
import { AppError } from '../common/errors/app-error.js';

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
  organisationId: string | null;
  mfa: boolean;
  sid: string;
}

/**
 * Short-lived access tokens with rotating refresh tokens (Phase 0 section 3.2).
 *
 * The refresh token is a random secret that is never stored -- only its hash is.
 * Rotation means a refresh consumes its token and issues a new one; presenting a
 * consumed token is treated as theft and revokes the whole family, because the
 * legitimate holder and the attacker cannot be told apart at that point.
 *
 * The issuer/audience pair is set so these tokens cannot be replayed against a
 * future OIDC-federated deployment.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    signingKey: string,
    private readonly accessTtlSeconds: number,
    private readonly refreshTtlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(signingKey);
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      roles: claims.roles,
      organisationId: claims.organisationId,
      mfa: claims.mfa,
      sid: claims.sid,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer('modex-apply')
      .setAudience('modex-apply-api')
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'modex-apply',
        audience: 'modex-apply-api',
      });
      return {
        sub: String(payload.sub),
        roles: (payload.roles as Role[] | undefined) ?? [],
        organisationId: (payload.organisationId as string | null | undefined) ?? null,
        mfa: payload.mfa === true,
        sid: String(payload.sid),
      };
    } catch (error) {
      const expired =
        error instanceof Error && error.message.toLowerCase().includes('exp');
      throw new AppError(
        expired ? 'token_expired' : 'unauthenticated',
        expired ? 'Your session has expired.' : 'This request is not authenticated.',
        { cause: error },
      );
    }
  }

  /** Returns the secret to hand the client and the hash to store. */
  mintRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString('base64url');
    return {
      token,
      hash: hashToken(token),
      expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return hashToken(token);
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare, so token lookup does not leak via response timing. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
