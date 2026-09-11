import { Injectable, Logger } from '@nestjs/common';
import {
  DATA_MAP,
  EXPORT_FORMAT_VERSION,
  erasurePlan,
  type AccessContext,
  type DataExport,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Access, export and erasure (Phase 7 §2).
 *
 * Three methods, and the third is the one that matters. `erase` does not
 * promise more than it can deliver: a submitted application is a record the
 * university holds too, a consent record is the evidence we asked, and the
 * audit log is append-only by construction. So erasure **deletes what it can,
 * anonymises what it must keep, and says which is which** — and the student
 * sees that list before they confirm, not afterwards.
 *
 * An erasure that silently left a name on a submitted application would be
 * worse than one that explains why the name stays.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * "Who has my data and why", answered from the student's own rows.
   *
   * The data map supplies the categories and the wording; this supplies the
   * counts and the names, so the page says "three universities" and names them
   * rather than describing a hypothetical.
   */
  async overview(access: AccessContext) {
    const [profile, documents, applications, conversations, consents, impersonations, payments] =
      await Promise.all([
        this.prisma.studentProfile.findUnique({
          where: { userId: access.userId },
          select: { updatedAt: true },
        }),
        this.prisma.document.count({ where: { ownerId: access.userId, deletedAt: null } }),
        this.prisma.application.findMany({
          where: { studentId: access.userId },
          select: {
            id: true,
            state: true,
            submittedAt: true,
            institution: { select: { displayName: true } },
          },
        }),
        this.prisma.conversation.findMany({
          where: { studentId: access.userId },
          select: {
            id: true,
            status: true,
            createdAt: true,
            guide: { select: { id: true, institution: { select: { displayName: true } } } },
          },
        }),
        this.prisma.consentGrant.findMany({
          where: { userId: access.userId },
          orderBy: { grantedAt: 'desc' },
        }),
        this.prisma.impersonationGrant.findMany({
          where: { subjectId: access.userId },
          orderBy: { startedAt: 'desc' },
          take: 50,
        }),
        this.prisma.modexTransaction.count({ where: { subjectUserId: access.userId } }),
      ]);

    return {
      dataMap: DATA_MAP,
      holdings: {
        profile: profile !== null,
        documents,
        applications: applications.map((row) => ({
          id: row.id,
          institution: row.institution.displayName,
          state: row.state,
          submittedAt: row.submittedAt?.toISOString() ?? null,
        })),
        guides: conversations.map((row) => ({
          conversationId: row.id,
          institution: row.guide.institution.displayName,
          status: row.status,
          since: row.createdAt.toISOString(),
        })),
        consents: consents.map((row) => ({
          scope: row.scope,
          grantedAt: row.grantedAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          noticeVersion: row.noticeVersion,
        })),
        /** Every support visit, open or finished. This is the student's record. */
        supportVisits: impersonations.map((row) => ({
          id: row.id,
          operatorId: row.operatorId,
          reason: row.reason,
          reference: row.reference,
          startedAt: row.startedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          endedAt: row.endedAt?.toISOString() ?? null,
        })),
        payments,
      },
      erasurePlan: erasurePlan(),
    };
  }

  /**
   * Portability: everything the student gave us, as JSON.
   *
   * Document *bytes* are deliberately not inlined. The export names each file
   * and its checksum; the files themselves come through the ordinary
   * signed-URL path, which refuses anything unscanned. Base64-ing a passport
   * into a JSON blob that then sits in a downloads folder is not a favour.
   */
  async export(access: AccessContext): Promise<DataExport> {
    const user = await this.prisma.user.findUnique({
      where: { id: access.userId },
      select: { id: true, email: true, displayName: true, phone: true, createdAt: true },
    });
    if (user === null) throw AppError.notFound('Account');

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'privacy.export_requested',
      objectType: 'user',
      objectId: access.userId,
    });

    const [profile, documents, applications, conversations, consents, sessions, transactions] =
      await Promise.all([
        this.prisma.studentProfile.findUnique({
          where: { userId: access.userId },
          include: { academicRecords: true, languageTests: true },
        }),
        this.prisma.document.findMany({
          where: { ownerId: access.userId, deletedAt: null },
          include: {
            versions: {
              select: {
                version: true,
                checksum: true,
                sizeBytes: true,
                contentType: true,
                scanState: true,
                createdAt: true,
              },
            },
          },
        }),
        this.prisma.application.findMany({
          where: { studentId: access.userId },
          include: {
            institution: { select: { displayName: true } },
            intake: { select: { startDate: true, applicationDeadline: true } },
          },
        }),
        this.prisma.conversation.findMany({
          where: { studentId: access.userId },
          include: {
            messages: {
              select: {
                senderRole: true,
                kind: true,
                body: true,
                sentAt: true,
                moderationState: true,
              },
              orderBy: { sentAt: 'asc' },
            },
          },
        }),
        this.prisma.consentGrant.findMany({ where: { userId: access.userId } }),
        this.prisma.session.findMany({
          where: { userId: access.userId },
          select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, revokedAt: true },
        }),
        this.prisma.modexTransaction.findMany({ where: { subjectUserId: access.userId } }),
      ]);

    const payload: DataExport = {
      formatVersion: EXPORT_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      subject: { userId: user.id, email: user.email },
      categories: {
        identity: { displayName: user.displayName, createdAt: user.createdAt },
        contact: { email: user.email, phone: user.phone },
        profile,
        documents,
        applications,
        messages: conversations,
        consents,
        sessions,
        payments: transactions,
      },
    };

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'privacy.export_completed',
      objectType: 'user',
      objectId: access.userId,
      metadata: {
        categories: Object.keys(payload.categories),
        documentCount: documents.length,
        applicationCount: applications.length,
      },
    });

    return payload;
  }

  /**
   * Erasure.
   *
   * Runs in one transaction, so a half-erased account cannot exist. The order
   * matters: object storage is emptied *after* the transaction commits, because
   * a rolled-back transaction must not leave files already gone.
   */
  async erase(access: AccessContext, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: access.userId },
      select: { id: true, email: true },
    });
    if (user === null) throw AppError.notFound('Account');

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'privacy.erasure_requested',
      objectType: 'user',
      objectId: user.id,
      metadata: { reason: reason ?? null },
    });

    const submitted = await this.prisma.application.count({
      where: {
        studentId: user.id,
        state: {
          in: ['submitted_pending', 'submitted', 'under_review', 'more_info', 'offer', 'accepted', 'enrolled'],
        },
      },
    });

    const objectKeys = (
      await this.prisma.documentVersion.findMany({
        where: { document: { ownerId: user.id } },
        select: { objectKey: true },
      })
    ).map((row) => row.objectKey);

    const result = await this.prisma.$transaction(async (tx) => {
      // Deleted outright: nothing else depends on them and nobody else's
      // record is entangled with them.
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // These hang off the profile rather than the user, and the profile is
      // deleted below — but deleting them explicitly keeps the order of
      // destruction readable rather than relying on a cascade to be right.
      await tx.savedSearch.deleteMany({ where: { profile: { userId: user.id } } });
      await tx.shortlistItem.deleteMany({ where: { shortlist: { profile: { userId: user.id } } } });
      await tx.shortlist.deleteMany({ where: { profile: { userId: user.id } } });
      await tx.languageTest.deleteMany({ where: { profile: { userId: user.id } } });
      await tx.academicRecord.deleteMany({ where: { profile: { userId: user.id } } });
      await tx.studentProfile.deleteMany({ where: { userId: user.id } });

      const documents = await tx.document.updateMany({
        where: { ownerId: user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      // Anonymised: the message stays because it is half somebody else's
      // conversation, and a flagged message is evidence. What goes is the link
      // to a person's name.
      const messages = await tx.message.updateMany({
        where: { conversation: { studentId: user.id }, senderId: user.id },
        data: { senderId: null },
      });

      // The account itself: closed, with identity removed. The row stays
      // because applications, payments and the audit trail all point at this
      // id, and a dangling id is worse for the student than a blank one.
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: 'closed',
          email: `erased+${user.id}@modex.invalid`,
          displayName: 'Erased account',
          phone: null,
          passwordHash: null,
          mfaSecretRef: null,
          mfaEnrolledAt: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
        },
      });

      return { documentsDeleted: documents.count, messagesAnonymised: messages.count };
    });

    // Object storage last, and best-effort: a file left behind is swept by the
    // retention job, whereas a file deleted against a transaction that then
    // rolled back is gone for no reason.
    let objectsRemoved = 0;
    for (const key of objectKeys) {
      try {
        await this.storage.deleteObject(key);
        objectsRemoved += 1;
      } catch (error) {
        this.logger.error(`Erasure could not remove ${key}: ${String(error)}`);
      }
    }

    await this.audit.record({
      actor: { id: user.id, type: 'user', roles: ['student'], organisationId: null, mfaSatisfied: false },
      action: 'privacy.erasure_completed',
      objectType: 'user',
      objectId: user.id,
      metadata: {
        ...result,
        objectsRemoved,
        retainedApplications: submitted,
        plan: erasurePlan().map((row) => `${row.category}:${row.treatment}`),
      },
    });

    return {
      erased: true,
      ...result,
      objectsRemoved,
      /** Named, not hidden: this is what we kept and why. */
      retained: {
        applications: submitted,
        explanation: erasurePlan().filter((row) => row.treatment !== 'deleted'),
      },
    };
  }
}
