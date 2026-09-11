import { Injectable } from '@nestjs/common';
import {
  PORTAL_BLOCKED_MESSAGE,
  canAccessUniversityPortal,
  describesChange,
  validateRequirement,
  type AccessContext,
  type ApplicationState,
  type RequirementReviewInput,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { currentContext } from '../common/observability/request-context.js';
import { assertOrganisationAccess } from '../auth/access-context.js';
import { ApplicationStateService } from '../applications/application-state.service.js';

/**
 * The university portal (FR-017, Phase 6 §1).
 *
 * Every method starts at `scope()`, and that is the design. A partner's staff
 * account is not "a staff account that happens to belong to Oxford" — it is an
 * account that can only ever address Oxford's rows, and the way to guarantee
 * that is for there to be no query in this file that does not begin by
 * resolving the caller's institution and filtering on it.
 *
 * `scope()` also enforces the portal gate: **no verified official domain, no
 * portal.** It is checked on every call rather than at sign-in, because a
 * domain can be revoked while somebody is in the middle of a session, and a
 * gate that only runs at the door is a gate that stays open.
 */
@Injectable()
export class UniversityPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applicationState: ApplicationStateService,
  ) {}

  /**
   * Resolves the institution this actor may address, or refuses.
   *
   * Modex staff pass an explicit `institutionId`; they cross the boundary by
   * design, and the crossing lands in the audit trail of whatever they do next.
   */
  async scope(access: AccessContext, requested?: string): Promise<string> {
    // An explicit request for another institution is refused rather than
    // quietly re-scoped to the caller's own. Silently answering a different
    // question than the one asked hides the attempt, and the acceptance
    // criterion is that a cross-organisation request is *rejected and audited*.
    if (requested !== undefined && access.organisationId !== null && requested !== access.organisationId) {
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'console.entered',
        objectType: 'institution',
        objectId: requested,
        metadata: {
          refused: 'organisation_boundary',
          callerOrganisationId: access.organisationId,
        },
      });
      throw new AppError(
        'organisation_boundary',
        'This record belongs to another institution.',
      );
    }

    const institutionId = access.organisationId ?? requested ?? null;
    if (institutionId === null) {
      throw AppError.forbidden('This account is not attached to an institution.');
    }
    assertOrganisationAccess(access, institutionId);

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: {
        id: true,
        verificationState: true,
        domainChallenges: {
          where: { confirmedAt: { not: null } },
          select: { confirmedAt: true },
          orderBy: { confirmedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (institution === null) throw AppError.notFound('Institution');

    const allowed = canAccessUniversityPortal({
      verificationState: institution.verificationState,
      domainConfirmedAt: institution.domainChallenges[0]?.confirmedAt ?? null,
    });
    if (!allowed) throw new AppError('precondition_failed', PORTAL_BLOCKED_MESSAGE);

    return institution.id;
  }

  /** Applications by stage, offers issued, the funnel, guides, catalogue freshness. */
  async dashboard(access: AccessContext, requested?: string) {
    const institutionId = await this.scope(access, requested);
    const now = new Date();

    const [byState, programmes, staleProgrammes, offers, guides, activeGuides, applications] =
      await Promise.all([
        this.prisma.application.groupBy({
          by: ['state'],
          where: { institutionId },
          _count: { _all: true },
        }),
        this.prisma.program.count({ where: { institutionId, status: 'published' } }),
        this.prisma.program.count({ where: { institutionId, syncState: 'stale' } }),
        this.prisma.offer.groupBy({
          by: ['publicationState'],
          where: { institutionId },
          _count: { _all: true },
        }),
        this.prisma.studentGuide.count({ where: { institutionId } }),
        this.prisma.studentGuide.count({ where: { institutionId, state: 'active' } }),
        this.prisma.application.count({ where: { institutionId } }),
      ]);

    const counts = Object.fromEntries(byState.map((row) => [row.state, row._count._all]));
    const reached = (states: ApplicationState[]) =>
      states.reduce((total, state) => total + (counts[state] ?? 0), 0);

    // The funnel is cumulative: an enrolled application also *reached* offer and
    // review. Counting each state on its own would show a funnel that grows at
    // the bottom, which is the kind of chart that gets screenshotted and
    // believed.
    const submitted = reached([
      'submitted',
      'under_review',
      'more_info',
      'offer',
      'accepted',
      'declined',
      'rejected',
      'enrolled',
    ]);
    const reviewed = reached([
      'under_review',
      'more_info',
      'offer',
      'accepted',
      'declined',
      'rejected',
      'enrolled',
    ]);
    const offered = reached(['offer', 'accepted', 'declined', 'enrolled']);
    const enrolled = reached(['enrolled']);

    return {
      institutionId,
      generatedAt: now.toISOString(),
      applications: { total: applications, byState: counts },
      funnel: [
        { stage: 'submitted', count: submitted },
        { stage: 'under_review', count: reviewed },
        { stage: 'offer', count: offered },
        { stage: 'enrolled', count: enrolled },
      ],
      conversion: {
        submittedToOffer: rate(offered, submitted),
        offerToEnrolment: rate(enrolled, offered),
      },
      offers: Object.fromEntries(offers.map((row) => [row.publicationState, row._count._all])),
      guides: { total: guides, active: activeGuides },
      catalogue: { published: programmes, stale: staleProgrammes },
    };
  }

  /**
   * The inbound applications queue.
   *
   * Student contact details are deliberately absent: the queue shows who
   * applied, for what, with which snapshot and which receipt. A university that
   * needs to reach the applicant does it through the application, which is
   * where the consent to do so is recorded.
   */
  async applications(
    access: AccessContext,
    filters: { state?: ApplicationState; institutionId?: string; limit?: number } = {},
  ) {
    const institutionId = await this.scope(access, filters.institutionId);
    const rows = await this.prisma.application.findMany({
      where: {
        institutionId,
        ...(filters.state === undefined ? {} : { state: filters.state }),
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(filters.limit ?? 100, 200),
      select: {
        id: true,
        state: true,
        programKey: true,
        currentOwner: true,
        externalRef: true,
        submittedAt: true,
        confirmedAt: true,
        updatedAt: true,
        operatorSubmittedById: true,
        student: { select: { id: true, displayName: true } },
        intake: { select: { id: true, startDate: true, applicationDeadline: true } },
        attempts: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: { id: true, state: true, externalRef: true, finishedAt: true, failureCode: true },
        },
      },
    });

    return rows.map((row) => ({
      ...row,
      /** Permanent on the record: a Modex operator submitted this one. */
      operatorAssisted: row.operatorSubmittedById !== null,
      latestAttempt: row.attempts[0] ?? null,
      attempts: undefined,
    }));
  }

  /**
   * A status update from the university, pushed into the application state
   * machine rather than written to the column directly.
   *
   * `authority: 'university'` is what the transition table checks. A portal that
   * could set any state would let a partner mark an application `submitted`
   * without ever giving a reference — the exact hole `submitted_pending` exists
   * to close.
   */
  async updateApplicationState(
    access: AccessContext,
    applicationId: string,
    to: ApplicationState,
    note?: string,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, institutionId: true },
    });
    if (application === null) throw AppError.notFound('Application');
    await this.scope(access, application.institutionId);

    return this.applicationState.transition({
      applicationId,
      to,
      actor: toAuditActor(access),
      authority: 'university',
      metadata: { note: note ?? null, source: 'university_portal' },
    });
  }

  /** The programme catalogue, scoped, with the freshness columns the console sorts on. */
  async programmes(access: AccessContext, requested?: string) {
    const institutionId = await this.scope(access, requested);
    return this.prisma.program.findMany({
      where: { institutionId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: 500,
      select: {
        id: true,
        programKey: true,
        name: true,
        level: true,
        status: true,
        syncState: true,
        version: true,
        effectiveFrom: true,
        effectiveTo: true,
        sourceUpdatedAt: true,
        verifiedAt: true,
        expiresAt: true,
        sourceRef: true,
        reviewedBy: true,
        staleFields: true,
      },
    });
  }

  /** Requirements for one programme, with their review history. */
  async requirements(access: AccessContext, programId: string) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, institutionId: true, name: true },
    });
    if (program === null) throw AppError.notFound('Programme');
    await this.scope(access, program.institutionId);

    const requirements = await this.prisma.requirement.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
    });

    // Reviews are joined in code rather than by a relation: `RequirementReview`
    // holds no foreign key, so the record of an override survives the
    // requirement being superseded.
    const reviews = await this.prisma.requirementReview.findMany({
      where: { requirementId: { in: requirements.map((row) => row.id) } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      program,
      requirements: requirements.map((requirement) => ({
        ...requirement,
        reviews: reviews.filter((review) => review.requirementId === requirement.id).slice(0, 5),
      })),
    };
  }

  /**
   * Approve, override or annotate a machine rule.
   *
   * Every outcome writes a `RequirementReview` row carrying the before and after
   * values, and an audit event carrying the same. An override additionally
   * rewrites the requirement — through `validateRequirement`, so a university
   * cannot replace a parseable rule with prose that the eligibility engine will
   * silently skip.
   */
  async reviewRequirement(
    access: AccessContext,
    requirementId: string,
    input: RequirementReviewInput,
  ) {
    if (!describesChange(input)) {
      throw AppError.validation('An override has to change something.', [
        { field: 'ruleJson', code: 'no_change', message: 'Supply a new rule or a new summary.' },
      ]);
    }

    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { program: { select: { institutionId: true } } },
    });
    if (requirement === null) throw AppError.notFound('Requirement');
    const institutionId = await this.scope(access, requirement.program.institutionId);
    const correlationId = currentContext()?.correlationId ?? 'admin';

    const afterRule = input.decision === 'overridden' ? (input.ruleJson ?? requirement.ruleJson) : null;
    const afterSummary =
      input.decision === 'approved' ? null : (input.humanSummary ?? requirement.humanSummary);

    if (input.decision === 'overridden') {
      // Refuses an unparseable rule before anything is written. A requirement
      // whose machine half does not parse is a requirement the engine cannot
      // explain, and an unexplainable requirement is how a student gets
      // rejected with no reason.
      const validation = validateRequirement({
        id: requirement.id,
        programId: requirement.programId,
        intakeId: requirement.intakeId,
        ruleType: requirement.ruleType,
        ruleJson: afterRule,
        humanSummary: afterSummary ?? requirement.humanSummary,
        sourceRef: requirement.sourceRef,
        version: requirement.version + 1,
      });
      if (!validation.ok) {
        throw AppError.validation('That rule is not one the eligibility engine can read.', [
          { field: 'ruleJson', code: 'unparseable_rule', message: validation.errors.join('; ') },
        ]);
      }
    }

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.requirementReview.create({
        data: {
          requirementId,
          institutionId,
          decision: input.decision,
          reason: input.reason,
          beforeRuleJson: requirement.ruleJson as object,
          beforeHumanSummary: requirement.humanSummary,
          afterRuleJson: afterRule === null ? undefined : (afterRule as object),
          afterHumanSummary: afterSummary,
          actorId: access.userId,
          correlationId,
        },
      });

      if (input.decision !== 'approved') {
        await tx.requirement.update({
          where: { id: requirementId },
          data: {
            ...(afterRule === null ? {} : { ruleJson: afterRule as object }),
            ...(afterSummary === null ? {} : { humanSummary: afterSummary }),
            version: { increment: 1 },
          },
        });
      }

      return created;
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'requirement.reviewed',
      objectType: 'requirement',
      objectId: requirementId,
      correlationId,
      metadata: {
        decision: input.decision,
        reason: input.reason,
        before: { ruleJson: requirement.ruleJson, humanSummary: requirement.humanSummary },
        after: { ruleJson: afterRule, humanSummary: afterSummary },
        reviewId: review.id,
      },
    });

    return review;
  }

  /** The guide roster for this institution, with verification state and expiry. */
  async guides(access: AccessContext, requested?: string) {
    const institutionId = await this.scope(access, requested);
    return this.prisma.studentGuide.findMany({
      where: { institutionId },
      orderBy: [{ state: 'asc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        state: true,
        stage: true,
        programKey: true,
        level: true,
        yearOfStudy: true,
        topics: true,
        verifiedAt: true,
        evidenceExpiresAt: true,
        universityEndorsed: true,
        trustScore: true,
        createdAt: true,
      },
    });
  }

  /**
   * Endorsement: the university confirming this guide is one of its students.
   *
   * Note what a university cannot do here — verify a guide. Verification is
   * Trust's, and a partner that could self-verify its own guides would make the
   * badge mean "the university says so", which is what the platform exists to
   * replace.
   */
  async setGuideEndorsement(access: AccessContext, guideId: string, endorsed: boolean) {
    const guide = await this.prisma.studentGuide.findUnique({
      where: { id: guideId },
      select: { id: true, institutionId: true },
    });
    if (guide === null) throw AppError.notFound('Guide');
    await this.scope(access, guide.institutionId);

    const updated = await this.prisma.studentGuide.update({
      where: { id: guideId },
      data: { universityEndorsed: endorsed },
      select: { id: true, universityEndorsed: true, state: true },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.profile_updated',
      objectType: 'guide',
      objectId: guideId,
      metadata: { universityEndorsed: endorsed, source: 'university_portal' },
    });

    return updated;
  }

  /** Application → offer → enrolment, by programme and by source market. */
  async analytics(access: AccessContext, requested?: string) {
    const institutionId = await this.scope(access, requested);

    const applications = await this.prisma.application.findMany({
      where: { institutionId },
      select: {
        programKey: true,
        state: true,
        intake: { select: { startDate: true } },
        student: { select: { studentProfile: { select: { nationality: true } } } },
      },
      take: 5_000,
    });

    const byProgramme = new Map<string, { programKey: string; applications: number; offers: number; enrolled: number }>();
    const byMarket = new Map<string, { market: string; applications: number; enrolled: number }>();

    for (const row of applications) {
      const programme = byProgramme.get(row.programKey) ?? {
        programKey: row.programKey,
        applications: 0,
        offers: 0,
        enrolled: 0,
      };
      programme.applications += 1;
      if (['offer', 'accepted', 'declined', 'enrolled'].includes(row.state)) programme.offers += 1;
      if (row.state === 'enrolled') programme.enrolled += 1;
      byProgramme.set(row.programKey, programme);

      // "Unknown" is its own bucket rather than being dropped: a market
      // breakdown that silently excludes students with no nationality on file
      // reports percentages of a number nobody can see.
      const market = row.student.studentProfile?.nationality ?? 'unknown';
      const entry = byMarket.get(market) ?? { market, applications: 0, enrolled: 0 };
      entry.applications += 1;
      if (row.state === 'enrolled') entry.enrolled += 1;
      byMarket.set(market, entry);
    }

    return {
      institutionId,
      programmes: [...byProgramme.values()].sort((a, b) => b.applications - a.applications),
      markets: [...byMarket.values()].sort((a, b) => b.applications - a.applications),
    };
  }

  // -------------------------------------------------------------------------
  // Organisation user management — `university_admin` only
  // -------------------------------------------------------------------------

  async staff(access: AccessContext, requested?: string) {
    const institutionId = await this.scope(access, requested);
    return this.prisma.user.findMany({
      where: { organisationId: institutionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        mfaEnrolledAt: true,
        createdAt: true,
        roles: { where: { revokedAt: null }, select: { role: true, grantedAt: true } },
      },
    });
  }

  /**
   * Changes a colleague's role.
   *
   * Two refusals that are easy to leave out and expensive to discover later:
   * an admin cannot demote themselves (the last admin would lock the
   * institution out of its own portal), and no role outside this institution's
   * two may be granted from here — a partner cannot mint a `trust_agent`.
   */
  async setStaffRole(
    access: AccessContext,
    userId: string,
    role: 'university_admin' | 'university_staff',
  ) {
    const institutionId = await this.scope(access);
    if (userId === access.userId) {
      throw AppError.forbidden('Ask another administrator to change your own role.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organisationId: true, roles: { where: { revokedAt: null } } },
    });
    if (user === null || user.organisationId !== institutionId) {
      throw AppError.notFound('That colleague');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleGrant.updateMany({
        where: {
          userId,
          role: { in: ['university_admin', 'university_staff'] },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.userRoleGrant.upsert({
        where: { userId_role_scopeId: { userId, role, scopeId: institutionId } },
        create: { userId, role, scopeId: institutionId, grantedBy: access.userId },
        update: { revokedAt: null, grantedBy: access.userId, grantedAt: new Date() },
      });
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'org_user.role_changed',
      objectType: 'user',
      objectId: userId,
      metadata: { role, institutionId },
    });

    return { userId, role };
  }
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
