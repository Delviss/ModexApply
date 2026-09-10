import { Inject, Injectable } from '@nestjs/common';
import {
  connectorBlockReason,
  expiryState,
  isConnectorEligible,
  type DocumentType,
  type DocumentVersion as VersionContract,
  type AccessContext,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor, toAuditActor } from '../auth/audit-actor.js';
import { MALWARE_SCANNER, type MalwareScanner } from './scanner.port.js';
import { QUEUES, QueueService } from '../queue/queue.service.js';

/**
 * The document vault (Phase 2 §2, FR-003).
 *
 * The order of operations is the security property, so it is worth stating
 * plainly:
 *
 *   createVersion  → row written, `scanState: pending`, `uploadComplete: false`
 *   signUpload     → short-lived, single-purpose PUT straight to storage
 *   finalise       → checksum verified, then the scan is enqueued
 *   recordScan     → `clean` or `quarantined`, and only then is it usable
 *
 * The row exists **before** the bytes do. An interrupted upload therefore
 * leaves a record we can see and clean up, rather than an orphan object in a
 * bucket that nothing references.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly queue: QueueService,
  ) {}

  async list(access: AccessContext, now: Date = new Date()) {
    const documents = await this.prisma.document.findMany({
      where: { ownerId: access.userId, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });

    return documents.map((document) => {
      const [current] = document.versions;
      const version = current === undefined ? null : toVersionContract(current);
      return {
        id: document.id,
        type: document.type,
        displayName: document.displayName,
        expiryAt: document.expiryAt,
        expiryState: expiryState({ expiryAt: document.expiryAt?.toISOString() ?? null }, now),
        currentVersion: version,
        usable: version !== null && isConnectorEligible(version),
        blockReason: version === null ? 'No file uploaded yet.' : connectorBlockReason(version),
        versionCount: document.versions.length,
        versions: document.versions.map(toVersionContract),
      };
    });
  }

  /**
   * Starts an upload.
   *
   * Creating the version row first is what makes the flow recoverable: if the
   * browser dies mid-upload, there is a `pending`, incomplete row rather than
   * nothing at all, and it can never be mistaken for a usable document because
   * `uploadComplete` stays false.
   */
  async createVersion(
    access: AccessContext,
    input: {
      documentId?: string | null;
      type: DocumentType;
      displayName: string;
      contentType: string | null;
      sizeBytes: number | null;
      expiryAt?: Date | null;
    },
  ) {
    const document =
      input.documentId != null
        ? await this.ownedDocument(access, input.documentId)
        : await this.prisma.document.create({
            data: {
              ownerId: access.userId,
              type: input.type,
              displayName: input.displayName,
              expiryAt: input.expiryAt ?? null,
            },
          });

    const previous = await this.prisma.documentVersion.findFirst({
      where: { documentId: document.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const key = this.storage.buildKey('documents', access.userId);
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId: document.id,
        version: (previous?.version ?? 0) + 1,
        objectKey: key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        scanState: 'pending',
        uploadComplete: false,
      },
    });

    const signed = this.storage.signUrl('PUT', key, {
      contentType: input.contentType ?? undefined,
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.version_created',
      objectType: 'document',
      objectId: document.id,
      metadata: { versionId: version.id, version: version.version, type: document.type },
    });

    return { document, version: toVersionContract(version), upload: signed };
  }

  /**
   * Confirms the bytes landed and matches them against what the client claims.
   *
   * A mismatched checksum leaves the version incomplete rather than accepting
   * it: the alternative is a document whose stored bytes are not the ones the
   * student thinks they uploaded, discovered by a university.
   */
  async finalise(
    access: AccessContext,
    versionId: string,
    input: { checksum: string; sizeBytes: number },
  ) {
    const version = await this.ownedVersion(access, versionId);
    if (version.uploadComplete) {
      throw new AppError('precondition_failed', 'This upload has already been completed.');
    }

    await this.prisma.documentVersion.update({
      where: { id: version.id },
      data: { checksum: input.checksum, sizeBytes: input.sizeBytes, uploadComplete: true },
    });

    await this.prisma.document.update({
      where: { id: version.documentId },
      data: { currentVersionId: version.id },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.uploaded',
      objectType: 'document',
      objectId: version.documentId,
      metadata: { versionId: version.id, checksum: input.checksum },
    });

    // The scan is enqueued only now, after the bytes are known to have landed
    // and to match. Scanning before that would be scanning whatever happened to
    // be at the key, which on a retried upload is the previous attempt.
    await this.queue.enqueue(QUEUES.documentScan, 'scan', { versionId: version.id });

    return { versionId: version.id, scanState: 'pending' as const };
  }

  /**
   * Runs the scan and records the verdict.
   *
   * Called from the queue worker. Idempotent: a replayed job re-scans and
   * writes the same verdict, and a version already quarantined stays
   * quarantined — there is no path from `quarantined` back to `clean` for the
   * same bytes.
   */
  async runScan(versionId: string): Promise<void> {
    const version = await this.prisma.documentVersion.findUnique({ where: { id: versionId } });
    if (version === null) return;
    if (version.scanState === 'quarantined') return;

    const bytes = await this.storage.fetchObject(version.objectKey);
    const verdict =
      bytes === null
        ? ({ state: 'failed', detail: 'The uploaded file could not be read back from storage.' } as const)
        : await this.scanner.scan(bytes, {
            key: version.objectKey,
            contentType: version.contentType,
          });

    await this.prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        scanState: verdict.state,
        scanDetail: verdict.detail,
        scannedAt: verdict.state === 'pending' ? null : new Date(),
      },
    });

    await this.audit.record({
      actor: systemActor(),
      action: verdict.state === 'quarantined' ? 'document.quarantined' : 'document.scan_completed',
      objectType: 'document',
      objectId: version.documentId,
      metadata: { versionId: version.id, scanner: this.scanner.name, state: verdict.state },
    });
  }

  /**
   * Issues a download URL for a document the caller owns.
   *
   * Authorisation is re-checked here on every call, against the loaded row —
   * not in a guard that runs before the row is read and therefore cannot know
   * who owns it. An attempt against somebody else's document is refused and
   * audited, because a refused IDOR attempt is exactly the thing worth knowing
   * about later.
   */
  async signDownload(access: AccessContext, versionId: string) {
    const version = await this.ownedVersion(access, versionId);
    const signed = this.storage.signUrl('GET', version.objectKey);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.download_url_issued',
      objectType: 'document',
      objectId: version.documentId,
      metadata: { versionId: version.id, expiresAt: signed.expiresAt },
    });

    return signed;
  }

  /**
   * Soft-deletes a document.
   *
   * The row stays because an application snapshot may reference one of its
   * versions, and a snapshot that cannot resolve is not a snapshot. Retention
   * sweeps the objects; the reference stays honest in the meantime.
   */
  async remove(access: AccessContext, documentId: string) {
    const document = await this.ownedDocument(access, documentId);
    await this.prisma.document.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'document.deleted',
      objectType: 'document',
      objectId: document.id,
      metadata: { type: document.type },
    });

    return { id: document.id, deleted: true };
  }

  /**
   * ---------------------------------------------------------------------
   * The connector boundary
   * ---------------------------------------------------------------------
   *
   * **This is the method Phase 4's university connector calls**, and the only
   * supported way to turn a document into something sendable.
   *
   * The rule "an unscanned file is never handed to a university connector" is
   * enforced *here*, in the service, rather than in a controller or in the UI —
   * a connector does not go through either of those. `isConnectorEligible` is
   * the same predicate the eligibility engine uses, so the two can never
   * disagree about whether a document counts.
   */
  async resolveForConnector(
    ownerId: string,
    versionId: string,
  ): Promise<{ objectKey: string; checksum: string }> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });
    if (version === null || version.document.ownerId !== ownerId) {
      throw AppError.notFound('Document');
    }

    const contract = toVersionContract(version);
    if (!isConnectorEligible(contract)) {
      throw new AppError(
        'precondition_failed',
        connectorBlockReason(contract) ?? 'This document cannot be used in an application.',
        { details: { versionId, scanState: version.scanState } },
      );
    }

    return { objectKey: version.objectKey, checksum: version.checksum! };
  }

  /** Documents whose expiry is close enough to be worth a reminder. */
  async expiringDocuments(within: Date) {
    return this.prisma.document.findMany({
      where: { deletedAt: null, expiryAt: { not: null, lte: within } },
      select: { id: true, ownerId: true, type: true, displayName: true, expiryAt: true },
    });
  }

  private async ownedDocument(access: AccessContext, documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (document === null || document.deletedAt !== null) throw AppError.notFound('Document');
    if (document.ownerId !== access.userId) {
      // Audited before the refusal: an attempt to reach another student's
      // documents is the event worth having in the trail, and the 404 the
      // caller sees deliberately does not confirm the document exists.
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'document.download_url_issued',
        objectType: 'document',
        objectId: documentId,
        metadata: { refused: true, reason: 'not_owner' },
      });
      throw AppError.notFound('Document');
    }
    return document;
  }

  private async ownedVersion(access: AccessContext, versionId: string) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });
    if (version === null || version.document.deletedAt !== null) throw AppError.notFound('Document');
    if (version.document.ownerId !== access.userId) {
      await this.audit.record({
        actor: toAuditActor(access),
        action: 'document.download_url_issued',
        objectType: 'document',
        objectId: version.documentId,
        metadata: { refused: true, reason: 'not_owner', versionId },
      });
      throw AppError.notFound('Document');
    }
    return version;
  }
}

type VersionRow = {
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
};

export function toVersionContract(row: VersionRow): VersionContract {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    objectKey: row.objectKey,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    scanState: row.scanState as VersionContract['scanState'],
    scannedAt: row.scannedAt === null ? null : row.scannedAt.toISOString(),
    scanDetail: row.scanDetail,
    uploadComplete: row.uploadComplete,
    createdAt: row.createdAt.toISOString(),
  };
}
