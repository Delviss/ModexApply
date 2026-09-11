import { Injectable } from '@nestjs/common';
import {
  SUBMISSION_CONSENTS,
  SUBMISSION_CONSENT_NOTICE_VERSION,
  connectorDescription,
  detectRequirementDrift,
  isSynchronousConnector,
  requiresPermanentDisclosure,
  submissionHeadline,
  type AccessContext,
  type AcknowledgedRequirement,
  type ApplicationState,
  type ConnectorType,
  type RequirementDrift,
  type SubmissionConsentId,
} from '@modex/contracts';
import { verifySnapshot } from '../common/crypto/payload-hash.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { EligibilityService } from '../eligibility/eligibility.service.js';
import { ApplicationStateService } from './application-state.service.js';
import { PayloadBuilderService } from './payload-builder.service.js';
import { SubmissionService } from './submission.service.js';

export interface StartApplicationInput {
  programKey: string;
  intakeId: string;
}

/**
 * Application lifecycle (Phase 4 §1, FR-009 and FR-012).
 *
 * The service owns three things the rest of the phase depends on:
 *
 *  1. **Re-validation at the submission boundary.** Between a student marking
 *     an application ready and the payload leaving, the university may have
 *     changed its requirements. That must block and explain, never silently
 *     pass — so what the student was shown is recorded at `ready` and compared
 *     at `submitted_pending`.
 *  2. **Snapshot before dispatch, always.** The snapshot is written in the same
 *     transaction as the move to `submitted_pending`, before any adapter is
 *     called. An application that reached a connector with no snapshot behind
 *     it would be unreproducible, which is the one thing FR-011 forbids.
 *  3. **Consent checked at submission time**, against this university and these
 *     documents — not against a consent the student gave some other week to
 *     somebody else.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly state: ApplicationStateService,
    private readonly payloads: PayloadBuilderService,
    private readonly submissions: SubmissionService,
    private readonly eligibility: EligibilityService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(access: AccessContext) {
    const applications = await this.prisma.application.findMany({
      where: { studentId: access.userId },
      include: {
        institution: { select: { id: true, displayName: true, country: true } },
        intake: { select: { id: true, startDate: true, applicationDeadline: true, status: true } },
        tasks: { where: { status: 'open' }, orderBy: { dueAt: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const programNames = await this.programNames(applications.map((a) => a.programKey));

    return applications.map((application) => ({
      id: application.id,
      state: application.state as ApplicationState,
      headline: submissionHeadline(
        application.state as ApplicationState,
        application.institution.displayName,
        application.externalRef,
      ),
      programKey: application.programKey,
      programName: programNames.get(application.programKey) ?? application.programKey,
      institution: application.institution,
      intake: application.intake,
      connectorType: application.connectorType as ConnectorType | null,
      externalRef: application.externalRef,
      submittedAt: application.submittedAt,
      confirmedAt: application.confirmedAt,
      operatorAssisted: application.operatorSubmittedAt !== null,
      nextAction: application.tasks[0]?.title ?? null,
      openTasks: application.tasks.length,
      updatedAt: application.updatedAt,
    }));
  }

  /** One application, with its timeline, tasks and receipts. */
  async detail(access: AccessContext, applicationId: string) {
    const application = await this.readable(access, applicationId);

    const [tasks, snapshots, attempts, events, institution, program] = await Promise.all([
      this.prisma.applicationTask.findMany({
        where: { applicationId },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      }),
      this.prisma.applicationSnapshot.findMany({
        where: { applicationId },
        orderBy: { submissionNo: 'asc' },
      }),
      this.prisma.submissionAttempt.findMany({
        where: { applicationId },
        orderBy: { attemptNo: 'asc' },
      }),
      this.prisma.applicationStatusEvent.findMany({
        where: { applicationId },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.institution.findUniqueOrThrow({
        where: { id: application.institutionId },
        select: { id: true, displayName: true, country: true },
      }),
      this.prisma.program.findFirst({
        where: { programKey: application.programKey, effectiveTo: null },
        select: { name: true, level: true, field: true },
      }),
    ]);

    const operator =
      application.operatorSubmittedById === null
        ? null
        : await this.prisma.user.findUnique({
            where: { id: application.operatorSubmittedById },
            select: { id: true, displayName: true },
          });

    return {
      id: application.id,
      state: application.state as ApplicationState,
      headline: submissionHeadline(
        application.state as ApplicationState,
        institution.displayName,
        application.externalRef,
      ),
      institution,
      program: { programKey: application.programKey, ...program },
      intakeId: application.intakeId,
      connectorType: application.connectorType as ConnectorType | null,
      connectorDescription:
        application.connectorType === null
          ? null
          : connectorDescription(application.connectorType as ConnectorType, institution.displayName),
      /** Drives the tracker's copy: a slow handoff is normal, a slow API is not. */
      awaitsExternalConfirmation:
        application.state === 'submitted_pending' &&
        application.connectorType !== null &&
        !isSynchronousConnector(application.connectorType as ConnectorType),
      externalRef: application.externalRef,
      submittedAt: application.submittedAt,
      confirmedAt: application.confirmedAt,
      /**
       * Permanent, not dismissible, and rendered whenever it is non-null. The
       * disclosure is the price of the operator-assisted exception existing.
       */
      operatorDisclosure:
        operator === null || application.operatorSubmittedAt === null
          ? null
          : {
              submittedBy: operator.displayName,
              submittedAt: application.operatorSubmittedAt,
              noticeVersion: SUBMISSION_CONSENT_NOTICE_VERSION,
              permanent: requiresPermanentDisclosure('operator_assisted'),
            },
      tasks,
      receipts: attempts.map((attempt) => ({
        attemptNo: attempt.attemptNo,
        state: attempt.state,
        externalRef: attempt.externalRef,
        failureReason: attempt.failureReason,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        correlationId: attempt.correlationId,
        /** The snapshot whose bytes this call sent. Retries share one. */
        snapshot: snapshotSummary(snapshots.find((s) => s.id === attempt.snapshotId)),
      })),
      /**
       * Every inbound event, including the ones that changed nothing. A student
       * disputing a decision needs the whole sequence, not the subset we acted
       * on. Attributed to the university, never to Modex.
       */
      universityEvents: events.map((event) => ({
        kind: event.kind,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
        applied: event.applied,
        skippedReason: event.skippedReason,
        attributedTo: institution.displayName,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(access: AccessContext, input: StartApplicationInput) {
    const intake = await this.prisma.intake.findUnique({ where: { id: input.intakeId } });
    if (intake === null || intake.programKey !== input.programKey) {
      throw AppError.notFound('Intake');
    }
    if (intake.status === 'closed' || intake.status === 'cancelled') {
      throw new AppError(
        'precondition_failed',
        'This intake is closed. Choose another intake for this programme.',
      );
    }

    const program = await this.prisma.program.findFirst({
      where: { programKey: input.programKey, effectiveTo: null, status: 'published' },
      select: { id: true, institutionId: true },
    });
    if (program === null) throw AppError.notFound('Programme');

    const existing = await this.prisma.application.findUnique({
      where: { studentId_intakeId: { studentId: access.userId, intakeId: input.intakeId } },
    });
    if (existing !== null) {
      throw new AppError(
        'conflict',
        'You already have an application for this intake.',
        { details: { applicationId: existing.id, state: existing.state } },
      );
    }

    // Frozen at creation. A route that changed underneath a draft would mean a
    // payload built for one protocol delivered over another.
    const connector = await this.prisma.connectorConfig.findFirst({
      where: { institutionId: program.institutionId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const application = await this.prisma.application.create({
      data: {
        studentId: access.userId,
        institutionId: program.institutionId,
        programKey: input.programKey,
        intakeId: input.intakeId,
        connectorId: connector?.id ?? null,
        connectorType: connector?.type ?? null,
        state: 'draft',
        currentOwner: 'student',
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'application.created',
      objectType: 'application',
      objectId: application.id,
      metadata: {
        programKey: input.programKey,
        intakeId: input.intakeId,
        connectorType: connector?.type ?? null,
      },
    });

    return this.detail(access, application.id);
  }

  /**
   * `draft → ready`.
   *
   * Validates against the requirements as they stand *now* and records exactly
   * what the student was shown, because that record is what the submission
   * boundary compares against later.
   */
  async markReady(access: AccessContext, applicationId: string) {
    const application = await this.owned(access, applicationId);

    const blockers = await this.readinessBlockers(application.studentId, application.programKey);
    if (blockers.length > 0) {
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'application.ready_blocked',
        objectType: 'application',
        objectId: applicationId,
        metadata: { blockers: blockers.map((blocker) => blocker.code) },
      });
      throw new AppError(
        'precondition_failed',
        'This application is not ready to submit yet.',
        { details: { blockers } },
      );
    }

    const acknowledged = await this.currentRequirements(application.programKey);

    if (application.state === 'ready') {
      // Already ready, and this is the *re-acknowledgement* path rather than a
      // no-op. When the university changes a requirement mid-application, the
      // submission is blocked and the student is told to "mark the application
      // ready again" — and refusing that as a same-state transition would make
      // the instruction impossible to follow. Nothing moves; what the student
      // has been shown is simply brought up to date.
      await this.prisma.application.update({
        where: { id: applicationId },
        data: { acknowledgedRequirements: acknowledged as unknown as object },
      });
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'application.updated',
        objectType: 'application',
        objectId: applicationId,
        metadata: { reacknowledgedRequirements: acknowledged.map((entry) => entry.id) },
      });
      return this.detail(access, applicationId);
    }

    await this.state.transition({
      applicationId,
      to: 'ready',
      actor: toAuditActor(access),
      authority: 'student',
      data: {
        acknowledgedRequirements: acknowledged as unknown as object,
        currentOwner: 'student',
      },
    });

    return this.detail(access, applicationId);
  }

  /**
   * What the student would have to fix before this can be submitted.
   *
   * Returned as a list rather than a first failure: the submit button is
   * disabled *with its blocking reasons listed*, and a button that reveals one
   * reason at a time is a button that takes five round trips to satisfy.
   */
  async readiness(access: AccessContext, applicationId: string) {
    const application = await this.owned(access, applicationId);
    const blockers = await this.readinessBlockers(application.studentId, application.programKey);
    const consents = await this.consentState(application.studentId, application.institutionId);
    return {
      ready: blockers.length === 0,
      blockers,
      consents,
      consentNoticeVersion: SUBMISSION_CONSENT_NOTICE_VERSION,
    };
  }

  private async readinessBlockers(
    studentId: string,
    programKey: string,
  ): Promise<{ code: string; message: string; remedy: string | null }[]> {
    const explanation = await this.eligibility.explain(programKey, studentId);
    const blockers: { code: string; message: string; remedy: string | null }[] = [];

    for (const check of explanation.checks) {
      // A `fail` does not block: an ineligible student may still apply, and
      // Phase 2's whole posture is that we explain rather than gatekeep. What
      // blocks is *missing* data, because a payload with a hole in it is a
      // wasted application rather than an unlikely one.
      if (check.outcome !== 'missing_data') continue;
      blockers.push({
        code: `requirement:${check.requirementId}`,
        message: check.reason,
        remedy: check.remedy,
      });
    }

    const quarantined = await this.prisma.documentVersion.count({
      where: {
        document: { ownerId: studentId, deletedAt: null },
        scanState: 'quarantined',
        version: { gt: 0 },
      },
    });
    if (quarantined > 0) {
      blockers.push({
        code: 'document:quarantined',
        message: `${quarantined} of your documents was blocked by our malware check and cannot be sent.`,
        remedy: 'Open your document vault and upload a clean copy.',
      });
    }

    return blockers;
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  /**
   * Records the individually-worded consents.
   *
   * Each one is a separate `ConsentGrant` row scoped to this institution, so
   * revoking "let the university contact me" does not revoke "send this
   * application". A single bundled grant would make them inseparable, which is
   * the thing the design rule about bundled checkboxes is actually about.
   */
  async recordConsents(
    access: AccessContext,
    applicationId: string,
    accepted: readonly SubmissionConsentId[],
  ) {
    const application = await this.owned(access, applicationId);

    const missing = SUBMISSION_CONSENTS.filter((consent) => !accepted.includes(consent.id));
    if (missing.length > 0) {
      throw new AppError(
        'consent_missing',
        'Every consent has to be given separately before an application can be sent.',
        { details: { missing: missing.map((consent) => consent.id) } },
      );
    }

    const now = new Date();
    for (const consent of SUBMISSION_CONSENTS) {
      await this.prisma.consentGrant.create({
        data: {
          userId: access.userId,
          scope: consent.scope,
          subjectId: application.institutionId,
          noticeVersion: `${SUBMISSION_CONSENT_NOTICE_VERSION}:${consent.id}`,
          grantedAt: now,
        },
      });
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'consent.granted',
        objectType: 'consent',
        objectId: `${access.userId}:${consent.id}`,
        metadata: {
          scope: consent.scope,
          subjectId: application.institutionId,
          applicationId,
          noticeVersion: SUBMISSION_CONSENT_NOTICE_VERSION,
        },
      });
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'application.consent_recorded',
      objectType: 'application',
      objectId: applicationId,
      metadata: { consents: SUBMISSION_CONSENTS.map((consent) => consent.id) },
    });

    return this.consentState(application.studentId, application.institutionId);
  }

  private async consentState(studentId: string, institutionId: string) {
    const grants = await this.prisma.consentGrant.findMany({
      where: { userId: studentId, subjectId: institutionId, revokedAt: null },
    });
    return SUBMISSION_CONSENTS.map((consent) => ({
      id: consent.id,
      title: consent.title,
      body: consent.body,
      scope: consent.scope,
      granted: grants.some((grant) =>
        grant.noticeVersion === `${SUBMISSION_CONSENT_NOTICE_VERSION}:${consent.id}`,
      ),
    }));
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * `ready → submitted_pending`, then dispatch.
   *
   * **The order is the guarantee**, and it is an order rather than a single
   * transaction: `ApplicationStateService.transition` runs its own serialisable
   * transaction for the audit chain, and nesting that inside another would
   * serialise every submission in the system behind one lock.
   *
   * Re-validate, then snapshot, then move state, then hand to the connector.
   * Each step is safe to die after, and only in this direction. A crash between
   * the snapshot and the state change leaves a snapshot for an application
   * still sitting in `ready` — an orphan row, and nothing was sent. The reverse
   * order would leave an application in flight with no record of what was in
   * it, which is the one outcome FR-011 exists to prevent.
   *
   * The client's `Idempotency-Key` is deliberately not a parameter here. It
   * guards the *request* and is handled by `IdempotencyService` in the
   * controller; the key the university dedupes on is derived from the snapshot
   * by `partnerIdempotencyKey`, so a client retrying with a fresh header still
   * cannot create a second application at the university.
   */
  async submit(
    access: AccessContext,
    applicationId: string,
    options: { operatorFor?: string } = {},
    now: Date = new Date(),
  ) {
    const application =
      options.operatorFor === undefined
        ? await this.owned(access, applicationId)
        : await this.forOperator(access, applicationId, options.operatorFor);

    if (application.state !== 'ready' && application.state !== 'failed') {
      throw AppError.stateTransition(
        application.state === 'submitted_pending'
          ? 'This application is already being sent to the university.'
          : 'Mark the application ready before submitting it.',
        { state: application.state },
      );
    }

    const drift = await this.requirementDrift(application);
    if (drift.length > 0) {
      // Back to `ready`-able rather than left in a state that suggests we are
      // still trying. The student has to look at the changed rule; nothing has
      // been sent.
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'application.ready_blocked',
        objectType: 'application',
        objectId: applicationId,
        metadata: { drift: drift.map((entry) => ({ kind: entry.kind, id: entry.requirementId })) },
      });
      throw new AppError(
        'precondition_failed',
        'The university changed what it asks for since you started this application.',
        { details: { requirementChanges: drift } },
      );
    }

    const consents = await this.consentState(application.studentId, application.institutionId);
    const ungranted = consents.filter((consent) => !consent.granted);
    if (ungranted.length > 0) {
      throw new AppError(
        'consent_missing',
        'We do not have every consent this submission needs.',
        { details: { missing: ungranted.map((consent) => consent.id) } },
      );
    }

    const built = await this.payloads.build(applicationId, now);
    const [previousSubmissions, previousAttempts] = await Promise.all([
      this.prisma.applicationSnapshot.count({ where: { applicationId } }),
      this.prisma.submissionAttempt.count({ where: { applicationId } }),
    ]);
    const submissionNo = previousSubmissions + 1;
    const attemptNo = previousAttempts + 1;

    const snapshot = await this.prisma.applicationSnapshot.create({
      data: {
        applicationId,
        submissionNo,
        profileVersion: built.profileVersion,
        documentVersionIds: built.documentVersionIds,
        payload: built.payload as unknown as object,
        payloadHash: built.hash,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'application.snapshot_created',
      objectType: 'application',
      objectId: applicationId,
      metadata: {
        submissionNo,
        payloadHash: built.hash,
        profileVersion: built.profileVersion,
        documentVersions: built.documentVersionIds,
      },
    });

    await this.state.transition({
      applicationId,
      to: 'submitted_pending',
      actor: toAuditActor(access),
      authority: options.operatorFor === undefined ? 'student' : 'system',
      data: {
        submittedAt: now,
        currentOwner: 'university',
        ...(options.operatorFor === undefined
          ? {}
          : { operatorSubmittedById: access.userId, operatorSubmittedAt: now }),
      },
      metadata: { submissionNo, attemptNo, payloadHash: built.hash },
    });

    if (options.operatorFor !== undefined) {
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'application.operator_submitted',
        objectType: 'application',
        objectId: applicationId,
        metadata: { studentId: application.studentId, submissionNo },
      });
    }

    const operator =
      options.operatorFor === undefined
        ? undefined
        : {
            userId: access.userId,
            displayName:
              (
                await this.prisma.user.findUnique({
                  where: { id: access.userId },
                  select: { displayName: true },
                })
              )?.displayName ?? 'Modex staff',
          };

    const result = await this.submissions.dispatch(
      {
        applicationId,
        snapshotId: snapshot.id,
        submissionNo,
        attemptNo,
        payload: built.payload,
        payloadHash: built.hash,
        documents: built.resolved,
        actor: toAuditActor(access),
        ...(operator === undefined ? {} : { operator }),
      },
      now,
    );

    const detail = await this.detail(access, applicationId);
    return {
      ...detail,
      /**
       * Returned rather than stored. A handoff URL is a short-lived bearer
       * credential for this student's own continuation; keeping a copy in a row
       * that ops and Trust can read would be keeping a copy that can be used.
       * The idempotent replay of this request returns the same one, and a fresh
       * attempt mints a fresh one.
       */
      continuation:
        result.outcome.status === 'handoff_required'
          ? { url: result.outcome.continuationUrl, expiresAt: result.outcome.expiresAt }
          : null,
    };
  }

  private async requirementDrift(application: {
    programKey: string;
    acknowledgedRequirements: unknown;
  }): Promise<RequirementDrift[]> {
    const acknowledged = Array.isArray(application.acknowledgedRequirements)
      ? (application.acknowledgedRequirements as AcknowledgedRequirement[])
      : [];
    const current = await this.currentRequirements(application.programKey);
    return detectRequirementDrift(acknowledged, current);
  }

  private async currentRequirements(programKey: string): Promise<AcknowledgedRequirement[]> {
    const program = await this.prisma.program.findFirst({
      where: { programKey, effectiveTo: null },
      include: { requirements: { orderBy: { id: 'asc' } } },
    });
    if (program === null) throw AppError.notFound('Programme');
    return program.requirements.map((requirement) => ({
      id: requirement.id,
      version: requirement.version,
      humanSummary: requirement.humanSummary,
    }));
  }

  // -------------------------------------------------------------------------
  // Student-driven transitions
  // -------------------------------------------------------------------------

  async withdraw(access: AccessContext, applicationId: string, reason: string) {
    await this.owned(access, applicationId);
    await this.state.transition({
      applicationId,
      to: 'withdrawn',
      actor: toAuditActor(access),
      authority: 'student',
      data: { withdrawnAt: new Date(), currentOwner: 'student' },
      metadata: { reason },
    });
    return this.detail(access, applicationId);
  }

  async respondToOffer(
    access: AccessContext,
    applicationId: string,
    decision: 'accepted' | 'declined',
  ) {
    await this.owned(access, applicationId);
    await this.state.transition({
      applicationId,
      to: decision,
      actor: toAuditActor(access),
      authority: 'student',
      data: { currentOwner: decision === 'accepted' ? 'university' : 'student' },
    });
    return this.detail(access, applicationId);
  }

  async completeTask(access: AccessContext, applicationId: string, taskId: string) {
    await this.owned(access, applicationId);
    const task = await this.prisma.applicationTask.findUnique({ where: { id: taskId } });
    if (task === null || task.applicationId !== applicationId) throw AppError.notFound('Task');
    if (task.owner !== 'student') {
      throw AppError.forbidden('This task is not yours to complete.');
    }

    await this.prisma.applicationTask.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date() },
    });
    await this.audit.record({
      actor: toAuditActor(access),
      action: 'application.task_completed',
      objectType: 'application',
      objectId: applicationId,
      metadata: { taskId, type: task.type },
    });
    return this.detail(access, applicationId);
  }

  // -------------------------------------------------------------------------
  // Reproducibility and the audit trace
  // -------------------------------------------------------------------------

  /**
   * Regenerates the payload from the snapshot and re-verifies its hash
   * (acceptance criteria 5 and 6).
   *
   * The student gets this as a downloadable submission summary; Trust gets it
   * as the answer to "what did we actually send them, and is that still true?".
   */
  async reproduce(access: AccessContext, applicationId: string, submissionNo: number) {
    await this.owned(access, applicationId);
    const snapshot = await this.prisma.applicationSnapshot.findUnique({
      where: { applicationId_submissionNo: { applicationId, submissionNo } },
    });
    if (snapshot === null) throw AppError.notFound('Snapshot');

    const verification = verifySnapshot({
      payload: snapshot.payload,
      payloadHash: snapshot.payloadHash,
    });

    return {
      submissionNo,
      createdAt: snapshot.createdAt,
      profileVersion: snapshot.profileVersion,
      documentVersionIds: snapshot.documentVersionIds,
      payload: snapshot.payload,
      storedHash: snapshot.payloadHash,
      recomputedHash: verification.recomputed,
      verified: verification.valid,
    };
  }

  /**
   * The full correlation trace, click to external call (FR-018).
   *
   * Built from the attempt rows rather than from one request's correlation ID,
   * because a submission spans several: the student's click, then each retry
   * from a job with its own. Collecting the ids off the attempts and reading
   * the audit trail for all of them is what makes the trace complete rather
   * than merely present.
   */
  async trace(access: AccessContext, applicationId: string) {
    const application = await this.readableByStaff(access, applicationId);

    const attempts = await this.prisma.submissionAttempt.findMany({
      where: { applicationId },
      orderBy: { attemptNo: 'asc' },
    });
    const correlationIds = [...new Set(attempts.map((attempt) => attempt.correlationId))];

    const events = await this.prisma.auditEvent.findMany({
      where: {
        OR: [
          { objectType: 'application', objectId: applicationId },
          ...(correlationIds.length === 0 ? [] : [{ correlationId: { in: correlationIds } }]),
        ],
      },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });

    return {
      applicationId,
      state: application.state,
      correlationIds,
      attempts: attempts.map((attempt) => ({
        attemptNo: attempt.attemptNo,
        state: attempt.state,
        correlationId: attempt.correlationId,
        externalRef: attempt.externalRef,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
      })),
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        actorType: event.actorType,
        objectType: event.objectType,
        objectId: event.objectId,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        integrityRef: event.integrityRef,
        metadata: event.metadata,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Scoping
  // -------------------------------------------------------------------------

  private async owned(access: AccessContext, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    // A 404 rather than a 403: a student probing ids must not be able to tell
    // "not yours" from "does not exist".
    if (application === null || application.studentId !== access.userId) {
      throw AppError.notFound('Application');
    }
    return application;
  }

  /**
   * Who may *read* an application: its owner, or staff holding
   * `application:read` within the right organisation boundary.
   *
   * Separate from `owned` because reading and acting are different questions,
   * and conflating them meant an operator could submit an application on a
   * student's behalf and then fail to read back what they had just done.
   */
  private async readable(access: AccessContext, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (application === null) throw AppError.notFound('Application');
    if (application.studentId === access.userId) return application;

    if (!access.permissions.has('application:read') || access.roles.includes('student')) {
      throw AppError.notFound('Application');
    }
    // The organisation boundary is checked here rather than inferred from the
    // role: university staff read their own institution's applications only.
    if (access.organisationId !== null && access.organisationId !== application.institutionId) {
      throw AppError.notFound('Application');
    }
    return application;
  }

  /** The operator-assisted path. Never reachable by a student's own token. */
  private async forOperator(access: AccessContext, applicationId: string, studentId: string) {
    if (!access.permissions.has('application:submit') || access.roles.includes('student')) {
      throw AppError.forbidden('Operator-assisted submission is not available to you.');
    }
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (application === null) throw AppError.notFound('Application');
    // The caller has to name the student they are acting for, and be right
    // about it. Accepting the parameter without checking it would make the
    // disclosure — "who submitted this, for whom" — a claim nobody verified.
    if (application.studentId !== studentId) {
      throw AppError.validation('That application does not belong to that student.', [
        { field: 'operatorFor', code: 'mismatch', message: 'Wrong student for this application.' },
      ]);
    }
    return application;
  }

  private async readableByStaff(access: AccessContext, applicationId: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (application === null) throw AppError.notFound('Application');

    if (application.studentId === access.userId) return application;
    if (access.permissions.has('audit:read')) {
      // University staff read only their own institution's applications; the
      // organisation boundary is checked here rather than assumed from the role.
      if (
        access.organisationId !== null &&
        access.organisationId !== application.institutionId
      ) {
        throw AppError.notFound('Application');
      }
      return application;
    }
    throw AppError.notFound('Application');
  }

  private async programNames(programKeys: readonly string[]): Promise<Map<string, string>> {
    if (programKeys.length === 0) return new Map();
    const programs = await this.prisma.program.findMany({
      where: { programKey: { in: [...programKeys] }, effectiveTo: null },
      select: { programKey: true, name: true },
    });
    return new Map(programs.map((program) => [program.programKey, program.name]));
  }
}

function snapshotSummary(
  snapshot: { submissionNo: number; payloadHash: string; createdAt: Date } | undefined,
) {
  return snapshot === undefined
    ? null
    : {
        submissionNo: snapshot.submissionNo,
        payloadHash: snapshot.payloadHash,
        createdAt: snapshot.createdAt,
      };
}
