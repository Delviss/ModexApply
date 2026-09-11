import { Injectable } from '@nestjs/common';
import {
  ApplicationPayloadSchema,
  connectorBlockReason,
  isConnectorEligible,
  type ApplicationPayload,
} from '@modex/contracts';
import { payloadHash, profileVersionOf } from '../common/crypto/payload-hash.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AppError } from '../common/errors/app-error.js';
import type { ResolvedDocument } from '../connectors/connector.port.js';

export interface BuiltPayload {
  payload: ApplicationPayload;
  hash: string;
  profileVersion: string;
  documentVersionIds: string[];
  /** What the adapter is handed. Never object keys, never bytes. */
  resolved: ResolvedDocument[];
}

/**
 * Builds the payload and resolves its documents (Phase 4 §2).
 *
 * **This is the adapter boundary for documents.** Every resolution goes through
 * `DocumentsService.resolveForConnector`, which is where Phase 2's "an unscanned
 * file never leaves" is enforced — and it is enforced here rather than in each
 * adapter deliberately: an adapter is the part of this system most likely to be
 * written by somebody in a hurry against a partner's deadline, and a guarantee
 * that depends on five adapters remembering it is not a guarantee.
 *
 * The check is doubled on purpose. `resolveForConnector` refuses a version that
 * is not clean; this service re-reads the version and refuses again before the
 * payload is built. The cost is one query and the benefit is that neither half
 * can be removed without a test going red.
 */
@Injectable()
export class PayloadBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  async build(applicationId: string, now: Date = new Date()): Promise<BuiltPayload> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { intake: true, student: true },
    });
    if (application === null) throw AppError.notFound('Application');

    const program = await this.prisma.program.findFirst({
      where: { programKey: application.programKey, effectiveTo: null },
      include: { requirements: { orderBy: { id: 'asc' } } },
    });
    if (program === null) {
      throw new AppError(
        'precondition_failed',
        'This programme is no longer published, so we cannot send an application for it.',
      );
    }

    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: application.studentId },
      include: {
        academicRecords: { orderBy: { startedAt: 'asc' } },
        languageTests: { orderBy: { takenAt: 'asc' } },
      },
    });
    if (profile === null) {
      throw new AppError(
        'precondition_failed',
        'Complete your profile before submitting an application.',
      );
    }

    const consents = await this.prisma.consentGrant.findMany({
      where: {
        userId: application.studentId,
        scope: { in: ['university_submission', 'document_share'] },
        subjectId: application.institutionId,
        revokedAt: null,
      },
      orderBy: { grantedAt: 'asc' },
    });
    if (consents.length === 0) {
      throw new AppError(
        'consent_missing',
        'We do not have your consent to send this application to the university.',
      );
    }

    const { documents, resolved } = await this.resolveDocuments(application.studentId);

    const profileSection = {
      // Computed below from this very object, so the version is a function of
      // what actually went into the payload rather than of a column somebody
      // has to remember to bump.
      profileVersion: '',
      intendedLevel: profile.intendedLevel,
      intendedField: profile.intendedField,
      workExperienceMonths: profile.workExperienceMonths,
      academicRecords: profile.academicRecords.map((record) => ({
        level: record.level,
        institutionName: record.institutionName,
        countryCode: record.countryCode,
        fieldOfStudy: record.fieldOfStudy,
        gradeScale: record.gradeScale,
        gradeValue: record.gradeValue,
        startedAt: record.startedAt.toISOString(),
        completedAt: record.completedAt?.toISOString() ?? null,
      })),
      languageTests: profile.languageTests.map((test) => ({
        test: test.test,
        overall: test.overall,
        bands: asNumberRecord(test.bands),
        takenAt: test.takenAt.toISOString(),
        expiresAt: test.expiresAt?.toISOString() ?? null,
      })),
    };
    const { profileVersion: _ignored, ...profileForHash } = profileSection;
    profileSection.profileVersion = profileVersionOf(profileForHash);

    const payload = ApplicationPayloadSchema.parse({
      payloadVersion: 1,
      application: {
        id: application.id,
        programKey: application.programKey,
        programId: program.id,
        programVersion: program.version,
        intakeId: application.intakeId,
        institutionId: application.institutionId,
      },
      student: {
        // Modex's id, not an email address. The university gets what it needs
        // to process an application; the contact channel is theirs to open
        // under the consent the student gave, not a field we push at them.
        reference: application.studentId,
        displayName: application.student.displayName,
        dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        nationality: profile.nationality,
        countryOfResidence: profile.countryOfResidence,
      },
      profile: profileSection,
      documents,
      requirements: program.requirements.map((requirement) => ({
        id: requirement.id,
        ruleType: requirement.ruleType,
        version: requirement.version,
        humanSummary: requirement.humanSummary,
      })),
      consents: consents.map((consent) => ({
        scope: consent.scope,
        subjectId: consent.subjectId,
        noticeVersion: consent.noticeVersion,
        grantedAt: consent.grantedAt.toISOString(),
      })),
      submittedAt: now.toISOString(),
    });

    return {
      payload,
      hash: payloadHash(payload),
      profileVersion: profileSection.profileVersion,
      documentVersionIds: documents.map((document) => document.versionId),
      resolved,
    };
  }

  /**
   * The vault, filtered to what may leave.
   *
   * A document the student has not had scanned clean is not an error here — it
   * is simply not included, and `ApplicationsService` refuses to reach `ready`
   * while a *required* document is in that state. The distinction matters: a
   * half-uploaded CV should not block an application that never needed one.
   * A quarantined file, by contrast, throws, because silently omitting it would
   * tell the student their application went out complete when it did not.
   */
  private async resolveDocuments(
    studentId: string,
  ): Promise<{ documents: ApplicationPayload['documents']; resolved: ResolvedDocument[] }> {
    const stored = await this.prisma.document.findMany({
      where: { ownerId: studentId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { type: 'asc' },
    });

    const documents: ApplicationPayload['documents'] = [];
    const resolved: ResolvedDocument[] = [];

    for (const document of stored) {
      const [version] = document.versions;
      if (version === undefined) continue;

      const contract = {
        id: version.id,
        documentId: version.documentId,
        version: version.version,
        objectKey: version.objectKey,
        checksum: version.checksum,
        sizeBytes: version.sizeBytes,
        contentType: version.contentType,
        scanState: version.scanState,
        scannedAt: version.scannedAt?.toISOString() ?? null,
        scanDetail: version.scanDetail,
        uploadComplete: version.uploadComplete,
        createdAt: version.createdAt.toISOString(),
      };

      if (version.scanState === 'quarantined') {
        throw new AppError(
          'precondition_failed',
          connectorBlockReason(contract) ??
            'One of your documents cannot be sent. Replace it before submitting.',
          { details: { documentId: document.id, scanState: version.scanState } },
        );
      }
      if (!isConnectorEligible(contract)) continue;

      // The guarantee, called here rather than trusted from the loop above: if
      // these two ever disagree, this throws and nothing is sent.
      const { objectKey, checksum } = await this.documents.resolveForConnector(
        studentId,
        version.id,
      );

      documents.push({
        documentId: document.id,
        versionId: version.id,
        version: version.version,
        type: document.type,
        checksum,
        sizeBytes: version.sizeBytes,
        contentType: version.contentType,
      });

      const signed = this.storage.signUrl('GET', objectKey, { ttlSeconds: 900 });
      resolved.push({
        documentId: document.id,
        versionId: version.id,
        type: document.type,
        checksum,
        sizeBytes: version.sizeBytes,
        contentType: version.contentType,
        fetchUrl: signed.url,
        fetchUrlExpiresAt: signed.expiresAt,
      });
    }

    return { documents, resolved };
  }
}

/** Language-test bands arrive as `Json`; the payload schema wants numbers. */
function asNumberRecord(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) output[key] = entry;
  }
  return output;
}
