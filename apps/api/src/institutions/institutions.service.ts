import { Injectable } from '@nestjs/common';
import {
  isVerifiedSignatory,
  type AccessContext,
  type PartnershipScope,
  type VerificationStage,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { QueueService, QUEUES } from '../queue/queue.service.js';
import { AppError } from '../common/errors/app-error.js';
import { assertOrganisationAccess, hasPermission } from '../auth/access-context.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { DomainVerificationService, normaliseDomain } from './domain-verification.service.js';
import {
  canPublishVerifiedBadge,
  evaluateTransition,
  stageStatuses,
  type StageEvidence,
} from './verification-state-machine.js';

export interface CreateInstitutionInput {
  legalName: string;
  displayName: string;
  domains: string[];
  country: string;
  websiteUrl?: string | null;
  description?: string | null;
}

/**
 * Institutions, partnerships and the verification pipeline (Phase 1 sections 1-2).
 *
 * The organisation boundary is enforced here rather than in a guard, because a
 * guard runs before the row is loaded and therefore cannot know which
 * institution it belongs to.
 */
@Injectable()
export class InstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domains: DomainVerificationService,
    private readonly queue: QueueService,
  ) {}

  async create(access: AccessContext, input: CreateInstitutionInput) {
    const institution = await this.prisma.institution.create({
      data: {
        legalName: input.legalName,
        displayName: input.displayName,
        domains: input.domains.map(normaliseDomain),
        country: input.country.toUpperCase(),
        websiteUrl: input.websiteUrl ?? null,
        description: input.description ?? null,
        partnerships: { create: { status: 'prospect', scopes: [] } },
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'institution.created',
      objectType: 'institution',
      objectId: institution.id,
      metadata: { legalName: input.legalName, country: institution.country },
    });

    return institution;
  }

  async findById(access: AccessContext | null, id: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id },
      include: {
        partnerships: { orderBy: { createdAt: 'desc' }, take: 1 },
        campuses: true,
        contacts: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isAuthorisedSignatory: true,
            verifiedAt: true,
          },
        },
      },
    });
    if (institution === null) throw AppError.notFound('Institution');

    // An authenticated institution user may only read their own record; the
    // public read path passes `null` and gets the public projection.
    if (access !== null) assertOrganisationAccess(access, institution.id);

    return institution;
  }

  /** The public projection. Verification evidence is never in it (Phase 1 section 2). */
  async findPublicBySlugOrId(id: string) {
    const institution = await this.prisma.institution.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        country: true,
        domains: true,
        websiteUrl: true,
        description: true,
        brandColor: true,
        verificationState: true,
        verificationStage: true,
        campuses: { select: { id: true, name: true, city: true, country: true, latitude: true, longitude: true } },
        partnerships: {
          where: { status: 'active' },
          select: { scopes: true, startDate: true, endDate: true, status: true },
          take: 1,
        },
      },
    });
    if (institution === null) throw AppError.notFound('Institution');

    return {
      ...institution,
      // There is no partial badge: either the institution is fully verified and
      // actively partnered, or it shows no verified badge at all.
      canDisplayVerifiedBadge: canPublishVerifiedBadge(
        institution.verificationStage,
        institution.verificationState,
      ),
      verificationPipeline: stageStatuses(
        institution.verificationStage,
        institution.verificationState,
      ),
    };
  }

  /**
   * Public list.
   *
   * An explicit projection rather than the whole row: a public endpoint that
   * returns whatever the ORM hands back starts leaking the moment somebody adds
   * a column, and nobody reviews a migration for that.
   */
  async list(query: { country?: string; verified?: boolean; cursor?: string; limit: number }) {
    const rows = await this.prisma.institution.findMany({
      where: {
        ...(query.country === undefined ? {} : { country: query.country.toUpperCase() }),
        ...(query.verified === true ? { verificationState: 'verified' as const } : {}),
      },
      select: {
        id: true,
        displayName: true,
        country: true,
        websiteUrl: true,
        description: true,
        verificationState: true,
        verificationStage: true,
        _count: { select: { campuses: true } },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });

    return rows.map(({ _count, ...institution }) => ({
      ...institution,
      campusCount: _count.campuses,
      canDisplayVerifiedBadge: canPublishVerifiedBadge(
        institution.verificationStage,
        institution.verificationState,
      ),
    }));
  }

  /**
   * Advances the verification pipeline by exactly one stage.
   *
   * Everything the state machine needs is gathered from the database here, so a
   * caller cannot assert "the domain is confirmed" as an argument. That is the
   * whole point: the shortcut is not merely refused, it is unavailable.
   */
  async advanceVerification(
    access: AccessContext,
    institutionId: string,
    targetStage: VerificationStage,
    options: { overrideJustification?: string | null } = {},
  ) {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: {
        id: true,
        domains: true,
        verificationStage: true,
        verificationState: true,
        contacts: {
          select: { email: true, verifiedAt: true, isAuthorisedSignatory: true },
        },
        partnerships: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, contractRef: true } },
        evidence: { where: { stage: 'legal_entity_check' }, select: { id: true }, take: 1 },
      },
    });
    if (institution === null) throw AppError.notFound('Institution');

    const evidence: StageEvidence = {
      domainConfirmed: await this.domains.isDomainConfirmed(institutionId),
      signatoryConfirmed: institution.contacts.some((contact) =>
        isVerifiedSignatory(
          {
            isAuthorisedSignatory: contact.isAuthorisedSignatory,
            verifiedAt: contact.verifiedAt?.toISOString() ?? null,
            email: contact.email,
          },
          institution.domains,
        ),
      ),
      contractRef: institution.partnerships[0]?.contractRef ?? null,
      legalEntityEvidenceId: institution.evidence[0]?.id ?? null,
    };

    const decision = evaluateTransition({
      currentStage: institution.verificationStage,
      targetStage,
      evidence,
      actorIsTrustAgent: hasPermission(access, 'institution:verify'),
      overrideJustification: options.overrideJustification ?? null,
    });

    if (!decision.allowed) {
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'institution.verification_failed',
        objectType: 'institution',
        objectId: institutionId,
        metadata: {
          fromStage: institution.verificationStage,
          targetStage,
          reason: decision.reason,
          evidence: { ...evidence, contractRef: evidence.contractRef === null ? null : 'present' },
        },
      });
      throw AppError.stateTransition(decision.reason ?? 'That transition is not allowed.', {
        fromStage: institution.verificationStage,
        targetStage,
      });
    }

    const updated = await this.prisma.institution.update({
      where: { id: institutionId },
      data: { verificationStage: targetStage, verificationState: decision.nextState },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: decision.isManualOverride
        ? 'institution.manual_override'
        : 'institution.verification_advanced',
      objectType: 'institution',
      objectId: institutionId,
      metadata: {
        fromStage: institution.verificationStage,
        toStage: targetStage,
        state: decision.nextState,
        manualOverride: decision.isManualOverride,
        justification: options.overrideJustification ?? null,
      },
    });

    if (targetStage === 'active' && institution.partnerships[0] !== undefined) {
      await this.prisma.institutionPartnership.update({
        where: { id: institution.partnerships[0].id },
        data: { status: 'active', startDate: new Date() },
      });
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'partnership.activated',
        objectType: 'partnership',
        objectId: institution.partnerships[0].id,
        metadata: { institutionId },
      });
    }

    return updated;
  }

  async recordEvidence(
    access: AccessContext,
    institutionId: string,
    input: { stage: VerificationStage; summary: string; documentRef?: string | null },
  ) {
    const evidence = await this.prisma.verificationEvidence.create({
      data: {
        institutionId,
        stage: input.stage,
        summary: input.summary,
        documentRef: input.documentRef ?? null,
        collectedBy: access.userId,
      },
      select: { id: true, stage: true, collectedAt: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'institution.updated',
      objectType: 'institution',
      objectId: institutionId,
      metadata: { evidenceStage: input.stage, evidenceId: evidence.id },
    });

    return evidence;
  }

  async updatePartnership(
    access: AccessContext,
    institutionId: string,
    input: { scopes?: PartnershipScope[]; contractRef?: string | null; markets?: string[]; endDate?: Date | null },
  ) {
    assertOrganisationAccess(access, institutionId);
    const partnership = await this.prisma.institutionPartnership.findFirst({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
    });
    if (partnership === null) throw AppError.notFound('Partnership');

    const updated = await this.prisma.institutionPartnership.update({
      where: { id: partnership.id },
      data: {
        ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
        ...(input.contractRef === undefined ? {} : { contractRef: input.contractRef }),
        ...(input.markets === undefined ? {} : { markets: input.markets }),
        ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'partnership.created',
      objectType: 'partnership',
      objectId: partnership.id,
      metadata: { institutionId, scopes: updated.scopes, contractRef: input.contractRef === undefined ? undefined : 'set' },
    });

    return updated;
  }

  /**
   * Revoking a partnership unpublishes its programmes and suspends its guides
   * within one job cycle (Phase 1 acceptance criteria).
   *
   * The programme unpublish happens inline and transactionally rather than on
   * the queue: a revoked partnership must not leave live programmes visible for
   * however long the queue happens to be backed up. The queue job handles the
   * slower cascade (guide roster, notifications, connector teardown).
   */
  async revokePartnership(access: AccessContext, institutionId: string, reason: string) {
    const partnership = await this.prisma.institutionPartnership.findFirst({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
    });
    if (partnership === null) throw AppError.notFound('Partnership');

    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.institutionPartnership.update({
        where: { id: partnership.id },
        data: { status: 'revoked', endDate: new Date() },
      });
      const unpublished = await tx.program.updateMany({
        where: { institutionId, status: 'published', effectiveTo: null },
        data: { status: 'unpublished' },
      });
      await tx.institution.update({
        where: { id: institutionId },
        data: { verificationState: 'revoked' },
      });
      return { revoked, unpublishedCount: unpublished.count };
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'partnership.revoked',
      objectType: 'partnership',
      objectId: partnership.id,
      metadata: { institutionId, reason, programmesUnpublished: result.unpublishedCount },
    });

    await this.queue.enqueue(QUEUES.partnershipCascade, 'revoke', {
      institutionId,
      partnershipId: partnership.id,
      reason,
    });

    return result;
  }

  async addContact(
    access: AccessContext,
    institutionId: string,
    input: {
      fullName: string;
      email: string;
      role: 'authorised_signatory' | 'admissions' | 'international_office' | 'technical' | 'finance';
      isAuthorisedSignatory: boolean;
    },
  ) {
    assertOrganisationAccess(access, institutionId);
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { domains: true },
    });
    if (institution === null) throw AppError.notFound('Institution');

    // A signatory on a free webmail address is exactly the gap this check closes.
    const emailDomain = input.email.split('@')[1]?.toLowerCase() ?? '';
    if (input.isAuthorisedSignatory && !institution.domains.map(normaliseDomain).includes(normaliseDomain(emailDomain))) {
      throw AppError.validation('An authorised signatory must use an official institution address.', [
        {
          field: 'email',
          code: 'off_domain',
          message: `${emailDomain} is not one of this institution's official domains.`,
        },
      ]);
    }

    return this.prisma.institutionContact.create({
      data: {
        institutionId,
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        role: input.role,
        isAuthorisedSignatory: input.isAuthorisedSignatory,
      },
      select: { id: true, fullName: true, email: true, role: true, isAuthorisedSignatory: true },
    });
  }
}
