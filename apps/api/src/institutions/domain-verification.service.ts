import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';

/**
 * Official-domain confirmation (Phase 1 section 2).
 *
 * The claim "this is the University of X" is only worth anything if X could have
 * stopped it. Confirmation therefore requires control of the domain itself: a
 * DNS TXT record only a domain administrator can publish, or a challenge sent to
 * an address on that domain.
 *
 * The token is never logged and never returned after issue; it exists in the
 * response once, and in the database.
 */
export const TXT_RECORD_PREFIX = 'modex-verification';
const CHALLENGE_TTL_HOURS = 72;
const MAX_ATTEMPTS = 20;

export interface DnsLookup {
  resolveTxt(hostname: string): Promise<string[][]>;
}

@Injectable()
export class DomainVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /** Injected so tests can drive DNS without a network. */
    private readonly dns: DnsLookup = new Resolver(),
  ) {}

  async issueChallenge(
    actor: AuditActor,
    institutionId: string,
    domain: string,
    method: 'dns_txt' | 'email_on_domain' = 'dns_txt',
  ): Promise<{ id: string; recordName: string; recordValue: string; expiresAt: string }> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { domains: true },
    });
    if (institution === null) throw AppError.notFound('Institution');

    const normalised = normaliseDomain(domain);
    if (!institution.domains.map(normaliseDomain).includes(normalised)) {
      throw AppError.validation('That domain is not claimed by this institution.', [
        { field: 'domain', code: 'not_claimed', message: `Add ${normalised} to the institution first.` },
      ]);
    }

    const token = `${TXT_RECORD_PREFIX}=${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_HOURS * 60 * 60 * 1000);

    const challenge = await this.prisma.domainChallenge.create({
      data: { institutionId, domain: normalised, method, token, expiresAt },
      select: { id: true },
    });

    await this.audit.record({
      actor,
      action: 'institution.domain_challenge_issued',
      objectType: 'institution',
      objectId: institutionId,
      // The token itself is on the redaction list, so it cannot reach the log
      // even if a caller passes it here by accident.
      metadata: { domain: normalised, method, challengeId: challenge.id },
    });

    return {
      id: challenge.id,
      recordName: `_modex-challenge.${normalised}`,
      recordValue: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Checks whether the challenge has been satisfied. Runs on a queue with
   * backoff, because DNS propagation is measured in hours and an institution
   * publishing the record correctly should not have to ask us to look again.
   */
  async checkChallenge(
    actor: AuditActor,
    challengeId: string,
  ): Promise<{ confirmed: boolean; reason: string | null }> {
    const challenge = await this.prisma.domainChallenge.findUnique({ where: { id: challengeId } });
    if (challenge === null) throw AppError.notFound('Domain challenge');
    if (challenge.confirmedAt !== null) return { confirmed: true, reason: null };
    if (challenge.expiresAt <= new Date()) {
      return { confirmed: false, reason: 'This challenge has expired. Issue a new one.' };
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      return { confirmed: false, reason: 'Too many checks against this challenge.' };
    }

    let records: string[][] = [];
    let lastError: string | null = null;
    try {
      records = await this.dns.resolveTxt(`_modex-challenge.${challenge.domain}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    // A TXT record can be split into several strings; joining is what the
    // resolver's chunking demands, not an optimisation.
    const found = records.some((chunks) => chunks.join('') === challenge.token);

    await this.prisma.domainChallenge.update({
      where: { id: challengeId },
      data: {
        attempts: { increment: 1 },
        confirmedAt: found ? new Date() : null,
        lastError: found ? null : (lastError ?? 'Record not found'),
      },
    });

    if (!found) {
      return {
        confirmed: false,
        reason:
          lastError === null
            ? 'The TXT record is not published yet, or has not propagated.'
            : `DNS lookup failed: ${lastError}`,
      };
    }

    await this.audit.record({
      actor,
      action: 'institution.domain_confirmed',
      objectType: 'institution',
      objectId: challenge.institutionId,
      metadata: { domain: challenge.domain, method: challenge.method, challengeId },
    });

    return { confirmed: true, reason: null };
  }

  async isDomainConfirmed(institutionId: string): Promise<boolean> {
    const confirmed = await this.prisma.domainChallenge.count({
      where: { institutionId, confirmedAt: { not: null } },
    });
    return confirmed > 0;
  }
}

export function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}
