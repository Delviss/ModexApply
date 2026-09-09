import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  canPublishProgram,
  deriveIntakeStatus,
  hasScope,
  publicVisibility,
  validateRequirement,
  type AccessContext,
  type Money,
  type ProgramLevel,
  type RuleType,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { assertOrganisationAccess } from '../auth/access-context.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { supersede } from './effective-dating.js';

export interface ProgramInput {
  name: string;
  level: ProgramLevel;
  field: string;
  durationMonths: number;
  studyMode?: 'full_time' | 'part_time' | 'distance' | 'hybrid';
  description?: string | null;
  campusId?: string | null;
  sourceRef?: string | null;
  sourceUpdatedAt?: Date | null;
}

export interface RequirementInput {
  ruleType: RuleType;
  ruleJson: unknown;
  humanSummary: string;
  sourceRef: string;
  intakeId?: string | null;
}

export interface FeesInput {
  tuition: Money;
  applicationFee?: Money | null;
  deposit?: Money | null;
  intakeId?: string | null;
  sourceRef?: string | null;
}

/**
 * The programme catalogue (Phase 1 section 3).
 *
 * The university is the source of truth for institutional facts. This service
 * stores, versions and displays them; it does not invent them, which is why
 * every write path insists on a source reference and every read path carries
 * provenance out with the record.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createProgram(access: AccessContext, institutionId: string, input: ProgramInput) {
    assertOrganisationAccess(access, institutionId);

    const program = await this.prisma.program.create({
      data: {
        programKey: randomUUID(),
        institutionId,
        campusId: input.campusId ?? null,
        name: input.name,
        level: input.level,
        field: input.field,
        durationMonths: input.durationMonths,
        studyMode: input.studyMode ?? 'full_time',
        description: input.description ?? null,
        status: 'draft',
        version: 1,
        sourceRef: input.sourceRef ?? null,
        sourceUpdatedAt: input.sourceUpdatedAt ?? new Date(),
        syncState: input.sourceRef === null || input.sourceRef === undefined ? 'manual' : 'pending_review',
        reviewedBy: access.userId,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'program.created',
      objectType: 'program',
      objectId: program.id,
      metadata: { institutionId, programKey: program.programKey, name: input.name },
    });

    return program;
  }

  /**
   * Editing a live programme writes a new effective-dated version and closes the
   * previous one. The prior version stays readable, and any application snapshot
   * that references it is unaffected (Phase 1 acceptance criteria).
   */
  async updateProgram(
    access: AccessContext,
    programKey: string,
    changes: Partial<ProgramInput>,
    now: Date = new Date(),
  ) {
    const current = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
    });
    if (current === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, current.institutionId);

    const plan = supersede(
      {
        id: current.id,
        programKey: current.programKey,
        version: current.version,
        effectiveFrom: current.effectiveFrom,
        effectiveTo: current.effectiveTo,
      },
      {
        institutionId: current.institutionId,
        campusId: changes.campusId === undefined ? current.campusId : changes.campusId,
        name: changes.name ?? current.name,
        level: changes.level ?? current.level,
        field: changes.field ?? current.field,
        durationMonths: changes.durationMonths ?? current.durationMonths,
        studyMode: changes.studyMode ?? current.studyMode,
        description: changes.description === undefined ? current.description : changes.description,
        status: current.status,
        sourceRef: changes.sourceRef === undefined ? current.sourceRef : changes.sourceRef,
        sourceUpdatedAt: changes.sourceUpdatedAt ?? now,
        verifiedAt: current.verifiedAt,
        expiresAt: current.expiresAt,
        syncState: current.syncState,
        reviewedBy: access.userId,
        staleFields: current.staleFields,
      },
      now,
    );

    const [, created] = await this.prisma.$transaction([
      this.prisma.program.update({
        where: { id: plan.close.id },
        data: { effectiveTo: plan.close.effectiveTo },
      }),
      this.prisma.program.create({ data: plan.create }),
    ]);

    // Requirements are dated to a programme version, so the new version starts
    // with a copy rather than inheriting rows that describe the old one.
    const requirements = await this.prisma.requirement.findMany({
      where: { programId: current.id },
    });
    if (requirements.length > 0) {
      await this.prisma.requirement.createMany({
        data: requirements.map((requirement) => ({
          programId: created.id,
          intakeId: requirement.intakeId,
          ruleType: requirement.ruleType,
          ruleJson: requirement.ruleJson as object,
          humanSummary: requirement.humanSummary,
          sourceRef: requirement.sourceRef,
          version: requirement.version,
        })),
      });
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'program.superseded',
      objectType: 'program',
      objectId: created.id,
      metadata: {
        programKey,
        previousVersionId: current.id,
        previousVersion: current.version,
        newVersion: created.version,
        changedFields: Object.keys(changes),
      },
    });

    return created;
  }

  /**
   * Publishing requires an institution in `active` partnership state with the
   * `catalogue_publish` scope, and at least one intake with a future deadline
   * (Phase 1 acceptance criteria).
   */
  async publishProgram(access: AccessContext, programKey: string, now: Date = new Date()) {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: {
        institution: {
          select: {
            id: true,
            partnerships: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (program === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, program.institutionId);

    const partnership = program.institution.partnerships[0];
    const intakes = await this.prisma.intake.findMany({ where: { programKey } });

    const decision = canPublishProgram({
      partnershipActive:
        partnership !== undefined &&
        hasScope(
          {
            status: partnership.status,
            startDate: partnership.startDate?.toISOString() ?? null,
            endDate: partnership.endDate?.toISOString() ?? null,
            scopes: partnership.scopes,
          },
          'catalogue_publish',
          now,
        ),
      hasCataloguePublishScope: partnership?.scopes.includes('catalogue_publish') ?? false,
      intakes: intakes.map((intake) => ({
        applicationDeadline: intake.applicationDeadline.toISOString(),
        status: intake.status,
      })),
      now,
    });

    if (!decision.ok) {
      throw AppError.stateTransition(decision.reason ?? 'This programme cannot be published.', {
        programKey,
      });
    }

    const published = await this.prisma.program.update({
      where: { id: program.id },
      data: { status: 'published', verifiedAt: now },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'program.published',
      objectType: 'program',
      objectId: program.id,
      metadata: { programKey, version: program.version },
    });

    return published;
  }

  async unpublishProgram(access: AccessContext, programKey: string, reason: string) {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      select: { id: true, institutionId: true },
    });
    if (program === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, program.institutionId);

    const updated = await this.prisma.program.update({
      where: { id: program.id },
      data: { status: 'unpublished' },
    });
    await this.audit.record({
      actor: toAuditActor(access),
      action: 'program.unpublished',
      objectType: 'program',
      objectId: program.id,
      metadata: { programKey, reason },
    });
    return updated;
  }

  async addIntake(
    access: AccessContext,
    programKey: string,
    input: { startDate: Date; applicationDeadline: Date; capacity?: number | null; sourceRef?: string | null },
    now: Date = new Date(),
  ) {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      select: { institutionId: true },
    });
    if (program === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, program.institutionId);

    if (input.applicationDeadline > input.startDate) {
      throw AppError.validation('The application deadline cannot fall after the start date.', [
        {
          field: 'applicationDeadline',
          code: 'after_start',
          message: 'Applications must close on or before the intake starts.',
        },
      ]);
    }

    const intake = await this.prisma.intake.create({
      data: {
        programKey,
        startDate: input.startDate,
        applicationDeadline: input.applicationDeadline,
        capacity: input.capacity ?? null,
        sourceRef: input.sourceRef ?? null,
        sourceUpdatedAt: now,
        syncState: input.sourceRef == null ? 'manual' : 'pending_review',
        reviewedBy: access.userId,
        // Deadlines are time-bound and drive automatic state changes, so the
        // status is derived rather than typed in.
        status: deriveIntakeStatus(
          {
            applicationDeadline: input.applicationDeadline.toISOString(),
            startDate: input.startDate.toISOString(),
            status: 'scheduled',
          },
          now,
        ),
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'intake.updated',
      objectType: 'intake',
      objectId: intake.id,
      metadata: { programKey, applicationDeadline: input.applicationDeadline.toISOString() },
    });

    return intake;
  }

  /**
   * Every requirement carries both a machine rule and a human summary. An
   * unparseable rule is rejected at write time rather than stored and discovered
   * later by the eligibility engine, which would have to guess.
   */
  async addRequirement(access: AccessContext, programKey: string, input: RequirementInput) {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      select: { id: true, institutionId: true },
    });
    if (program === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, program.institutionId);

    const candidate = {
      id: randomUUID(),
      programId: program.id,
      intakeId: input.intakeId ?? null,
      ruleType: input.ruleType,
      ruleJson: input.ruleJson,
      humanSummary: input.humanSummary,
      sourceRef: input.sourceRef,
      version: 1,
    };

    const validation = validateRequirement(candidate);
    if (!validation.ok) {
      throw AppError.validation('This requirement is not storable.', [
        ...validation.errors.map((message) => ({
          field: message.split(':')[0]?.trim() ?? 'ruleJson',
          code: 'invalid_requirement',
          message,
        })),
      ]);
    }

    const requirement = await this.prisma.requirement.create({
      data: {
        programId: program.id,
        intakeId: input.intakeId ?? null,
        ruleType: input.ruleType,
        ruleJson: input.ruleJson as object,
        humanSummary: input.humanSummary,
        sourceRef: input.sourceRef,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'requirement.updated',
      objectType: 'requirement',
      objectId: requirement.id,
      metadata: { programKey, ruleType: input.ruleType, sourceRef: input.sourceRef },
    });

    return requirement;
  }

  async setFees(access: AccessContext, programKey: string, input: FeesInput, now: Date = new Date()) {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      select: { id: true, institutionId: true },
    });
    if (program === null) throw AppError.notFound('Programme');
    assertOrganisationAccess(access, program.institutionId);

    return this.prisma.programFees.create({
      data: {
        programId: program.id,
        intakeId: input.intakeId ?? null,
        tuitionMinor: input.tuition.amountMinor,
        tuitionCurrency: input.tuition.currency,
        applicationFeeMinor: input.applicationFee?.amountMinor ?? null,
        applicationFeeCurrency: input.applicationFee?.currency ?? null,
        depositMinor: input.deposit?.amountMinor ?? null,
        depositCurrency: input.deposit?.currency ?? null,
        sourceRef: input.sourceRef ?? null,
        sourceUpdatedAt: now,
        syncState: input.sourceRef == null ? 'manual' : 'pending_review',
        reviewedBy: access.userId,
      },
    });
  }

  /**
   * The public programme page payload.
   *
   * Visibility is computed from provenance, not assumed: a record whose tuition
   * or deadline is stale is hidden rather than shown with a caveat, because a
   * wrong price is worse than an absent one.
   */
  async getPublicProgram(programKey: string, now: Date = new Date()) {
    // Deliberately not filtered on `status: 'published'`. A programme the
    // freshness sweep pulled back to `in_review` still exists, and answering a
    // bookmarked link with a bare 404 tells a student the programme is gone when
    // the truth is that we are re-confirming a figure with the university. The
    // two cases are distinguished below and answered differently.
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: {
        institution: { select: { id: true, displayName: true, country: true, verificationState: true, verificationStage: true } },
        campus: { select: { name: true, city: true, country: true } },
        requirements: true,
        fees: { orderBy: { sourceUpdatedAt: 'desc' }, take: 1 },
      },
    });
    if (program === null) throw AppError.notFound('Programme');

    // Never-published and deliberately withdrawn programmes are genuinely not
    // public, and saying so is correct.
    if (program.status === 'draft' || program.status === 'archived' || program.status === 'unpublished') {
      throw AppError.notFound('Programme');
    }

    const visibility = publicVisibility(program.syncState, program.staleFields);
    if (visibility === 'hidden' || program.status === 'in_review') {
      throw new AppError(
        'precondition_failed',
        'This programme is temporarily unavailable while we confirm its details with the university.',
        { details: { reason: 'stale_blocking_fields', staleFields: program.staleFields } },
      );
    }

    const intakes = await this.prisma.intake.findMany({
      where: { programKey },
      orderBy: { applicationDeadline: 'asc' },
    });

    return {
      program,
      visibility,
      intakes: intakes.map((intake) => ({
        ...intake,
        status: deriveIntakeStatus(
          {
            applicationDeadline: intake.applicationDeadline.toISOString(),
            startDate: intake.startDate.toISOString(),
            status: intake.status,
          },
          now,
        ),
      })),
    };
  }

  /** Every version of a programme, oldest first. The history is readable. */
  async programHistory(programKey: string) {
    return this.prisma.program.findMany({
      where: { programKey },
      orderBy: { version: 'asc' },
    });
  }
}
