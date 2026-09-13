import { Injectable } from '@nestjs/common';
import {
  ASSESSMENT_SLA_HOURS,
  assessmentState,
  canAssess,
  assessmentBlockReason,
  escalatesToTrust,
  isOverdue,
  median,
  percentile,
  hoursBetween,
  type AccessContext,
  type AssessmentDecisionInput,
  type DocumentVersion,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { assertOrganisationAccess } from '../auth/access-context.js';

/**
 * Document assessment (Phase 8, #20).
 *
 * The vault already answers "are these bytes safe to move". This service
 * answers the question a reviewer actually has in front of them: **is this the
 * document it claims to be, and can the student use it?** The rules that decide
 * that live in `@modex/contracts/document-review` so the console renders the
 * same answer the API enforces; what lives here is the part a client must never
 * be trusted with.
 *
 * Three of those are worth reading before changing anything:
 *
 * **Opening a file is an audited write, not a read.** `open()` records that a
 * named person looked at a named student's passport scan, at a time. Every
 * other read in this codebase is unaudited on purpose — auditing reads buries
 * the writes — and this is the second exception after verification evidence,
 * for the same reason: the harm happens at the moment of looking.
 *
 * **The scan gate is checked here, against the row, every time.** Not at queue
 * build time. A version can be quarantined by a scan that finishes while the
 * reviewer is reading the list, and a gate that runs only when the list is
 * drawn is a gate that was open when it mattered.
 *
 * **A partner sees only what was sent to it.** An institution-scoped reviewer
 * addresses a version through the application that carried it to them. There is
 * no query in this file that lets a partner reach a vault document they were
 * never sent.
 */
@Injectable()
export class DocumentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Which institution this actor reviews for, or `null` for Modex staff.
   *
   * A requested id that is not the caller's own is refused outright rather than
   * quietly re-scoped, matching `UniversityPortalService.scope`: silently
   * answering a different question hides the attempt.
   */
  private scope(access: AccessContext, requested?: string | null): string | null {
    if (requested != null) {
      assertOrganisationAccess(access, requested);
      return requested;
    }
    return access.organisationId;
  }

  /**
   * The review queue.
   *
   * Ordered by age, oldest first, for the same reason as the trust queue: a
   * queue sorted any other way is a queue where the person who has waited
   * longest is the person nobody reaches.
   */
  async queue(
    access: AccessContext,
    options: { state?: 'awaiting' | 'decided' | 'all'; institutionId?: string | null; limit?: number } = {},
  ) {
    const institutionId = this.scope(access, options.institutionId);
    const limit = Math.min(options.limit ?? 50, 200);
    const wanted = options.state ?? 'awaiting';

    // A partner reviews what reached it. Modex staff review the vault rows that
    // were attached to any application, which is the same set without the
    // institution filter — never "every document anybody ever uploaded".
    const applications = await this.prisma.application.findMany({
      where: institutionId === null ? {} : { institutionId },
      select: { id: true, studentId: true, institutionId: true, programKey: true, state: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });
    const studentIds = [...new Set(applications.map((one) => one.studentId))];
    if (studentIds.length === 0) return { data: [], summary: this.emptySummary() };

    const versions = await this.prisma.documentVersion.findMany({
      where: { document: { ownerId: { in: studentIds }, deletedAt: null } },
      select: {
        id: true,
        documentId: true,
        version: true,
        objectKey: true,
        checksum: true,
        sizeBytes: true,
        contentType: true,
        scanState: true,
        scannedAt: true,
        scanDetail: true,
        uploadComplete: true,
        createdAt: true,
        document: { select: { id: true, ownerId: true, type: true, displayName: true, expiryAt: true } },
        assessments: {
          where: institutionId === null ? { institutionId: null } : { institutionId },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const rows = versions.map((version) => {
      const assessment = version.assessments[0] ?? null;
      const projected = this.projectVersion(version);
      const state = assessmentState(projected, assessment === null ? null : {
        decision: assessment.decision,
        startedAt: assessment.openedAt?.toISOString() ?? null,
      });
      const application = applications.find((one) => one.studentId === version.document.ownerId) ?? null;

      return {
        documentVersionId: version.id,
        documentId: version.documentId,
        studentId: version.document.ownerId,
        type: version.document.type,
        displayName: version.document.displayName,
        version: version.version,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        uploadedAt: version.createdAt.toISOString(),
        scanState: version.scanState,
        state,
        openable: canAssess(projected),
        blockReason: assessmentBlockReason(projected),
        decision: assessment?.decision ?? null,
        reasons: assessment?.reasons ?? [],
        note: assessment?.note ?? null,
        decidedAt: assessment?.decidedAt?.toISOString() ?? null,
        overdue: isOverdue({
          createdAt: version.createdAt.toISOString(),
          decidedAt: assessment?.decidedAt?.toISOString() ?? null,
        }),
        applicationId: application?.id ?? null,
        programKey: application?.programKey ?? null,
      };
    });

    const filtered = rows.filter((row) => {
      if (wanted === 'all') return true;
      const decided = row.decision !== null;
      return wanted === 'decided' ? decided : !decided;
    });

    return { data: filtered.slice(0, limit), summary: this.summarise(rows) };
  }

  private emptySummary() {
    return {
      awaitingScan: 0,
      awaitingReview: 0,
      decided: 0,
      overdue: 0,
      quarantined: 0,
      slaHours: ASSESSMENT_SLA_HOURS,
      medianDecisionHours: null as number | null,
      p90DecisionHours: null as number | null,
    };
  }

  private summarise(rows: readonly { state: string; overdue: boolean; scanState: string; uploadedAt: string; decidedAt: string | null }[]) {
    const durations = rows
      .filter((row) => row.decidedAt !== null)
      .map((row) => hoursBetween(row.uploadedAt, row.decidedAt as string));

    return {
      awaitingScan: rows.filter((row) => row.state === 'awaiting_scan').length,
      awaitingReview: rows.filter((row) => row.state === 'awaiting_review' || row.state === 'in_review').length,
      decided: rows.filter((row) => row.decidedAt !== null).length,
      overdue: rows.filter((row) => row.overdue).length,
      quarantined: rows.filter((row) => row.scanState === 'quarantined').length,
      slaHours: ASSESSMENT_SLA_HOURS,
      medianDecisionHours: median(durations),
      p90DecisionHours: percentile(durations, 0.9),
    };
  }

  /**
   * Opens one version for review.
   *
   * Returns the file's metadata and a signed URL request is *not* issued here —
   * the storage layer owns that, and this endpoint deliberately hands back only
   * what a reviewer needs to decide plus the audited fact that they opened it.
   */
  async open(access: AccessContext, documentVersionId: string, institutionId?: string | null) {
    const scopedTo = this.scope(access, institutionId);
    const version = await this.loadVersion(documentVersionId, scopedTo);
    const projected = this.projectVersion(version);

    if (!canAssess(projected)) {
      throw new AppError('precondition_failed', assessmentBlockReason(projected) ?? 'This file cannot be opened.');
    }

    const existing = await this.prisma.documentAssessment.findFirst({
      where: { documentVersionId, institutionId: scopedTo },
    });

    const assessment = existing
      ? await this.prisma.documentAssessment.update({
          where: { id: existing.id },
          data: existing.openedAt === null
            ? { openedAt: new Date(), openedById: access.userId }
            : {},
        })
      : await this.prisma.documentAssessment.create({
          data: {
            documentVersionId,
            documentId: version.documentId,
            studentId: version.document.ownerId,
            institutionId: scopedTo,
            openedAt: new Date(),
            openedById: access.userId,
          },
        });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.review_opened',
      objectType: 'document_version',
      objectId: documentVersionId,
      metadata: {
        assessmentId: assessment.id,
        institutionId: scopedTo,
        documentType: version.document.type,
        // Never the file name or the student's name: the audit row says what was
        // opened and by whom, and adding the contents of what was opened to the
        // log would spread the disclosure it exists to record.
      },
    });

    return { data: assessment };
  }

  /**
   * Records a decision.
   *
   * The refusal to decide on an unopened file is not bureaucracy: a verdict on
   * a document nobody opened is a verdict on a file name.
   */
  async decide(
    access: AccessContext,
    documentVersionId: string,
    input: AssessmentDecisionInput,
    institutionId?: string | null,
  ) {
    const scopedTo = this.scope(access, institutionId);
    const version = await this.loadVersion(documentVersionId, scopedTo);
    const projected = this.projectVersion(version);
    if (!canAssess(projected)) {
      throw new AppError('precondition_failed', assessmentBlockReason(projected) ?? 'This file cannot be assessed.');
    }

    const existing = await this.prisma.documentAssessment.findFirst({
      where: { documentVersionId, institutionId: scopedTo },
    });
    if (existing === null || existing.openedAt === null) {
      throw new AppError(
        'precondition_failed',
        'Open the document before deciding on it. A verdict on a file nobody opened is a verdict on a file name.',
      );
    }
    if (existing.decision !== null) {
      throw new AppError(
        'conflict',
        'This version already carries a decision. A different verdict needs a new upload, which is a new version.',
      );
    }

    const decided = await this.prisma.documentAssessment.update({
      where: { id: existing.id },
      data: {
        decision: input.decision,
        reasons: input.reasons,
        note: input.note,
        reviewerId: access.userId,
        decidedAt: new Date(),
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.assessed',
      objectType: 'document_version',
      objectId: documentVersionId,
      metadata: {
        assessmentId: decided.id,
        decision: input.decision,
        reasons: input.reasons,
        institutionId: scopedTo,
        escalated: escalatesToTrust({ reasons: input.reasons }),
      },
    });

    return { data: decided, escalatesToTrust: escalatesToTrust({ reasons: input.reasons }) };
  }

  /** Loads the version and proves this actor was sent it. */
  private async loadVersion(documentVersionId: string, institutionId: string | null) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: {
        id: true,
        documentId: true,
        version: true,
        objectKey: true,
        checksum: true,
        sizeBytes: true,
        contentType: true,
        scanState: true,
        scannedAt: true,
        scanDetail: true,
        uploadComplete: true,
        createdAt: true,
        document: { select: { id: true, ownerId: true, type: true, displayName: true } },
      },
    });
    if (version === null) throw AppError.notFound('Document version');

    if (institutionId !== null) {
      const reachable = await this.prisma.application.count({
        where: { institutionId, studentId: version.document.ownerId },
      });
      if (reachable === 0) {
        throw new AppError(
          'organisation_boundary',
          'This document was never sent to your institution.',
        );
      }
    }

    return version;
  }

  /** The row, in the shape the shared predicates expect. */
  private projectVersion(version: {
    id: string;
    documentId: string;
    version: number;
    objectKey: string;
    checksum: string | null;
    sizeBytes: number | null;
    contentType: string | null;
    scanState: string;
    scannedAt: Date | null;
    scanDetail: string | null;
    uploadComplete: boolean;
    createdAt: Date;
  }): DocumentVersion {
    return {
      id: version.id,
      documentId: version.documentId,
      version: version.version,
      objectKey: version.objectKey,
      checksum: version.checksum,
      sizeBytes: version.sizeBytes,
      contentType: version.contentType,
      scanState: version.scanState as DocumentVersion['scanState'],
      scannedAt: version.scannedAt?.toISOString() ?? null,
      scanDetail: version.scanDetail,
      uploadComplete: version.uploadComplete,
      createdAt: version.createdAt.toISOString(),
    };
  }
}
