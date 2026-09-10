import { z } from 'zod';

/**
 * The document vault (Phase 2 §2, FR-003).
 *
 * Two rules shape every type in this file:
 *
 * 1. **Versions are never overwritten.** A `Document` points at a current
 *    version; replacing a file writes a new `DocumentVersion` row. An
 *    application snapshot references an exact version, and that reference has
 *    to stay resolvable after the student uploads a better scan of the same
 *    transcript.
 * 2. **An unscanned file is never handed to a university connector.** The
 *    predicate that decides this lives here, in the contract both sides import,
 *    rather than in a service one caller can forget to go through.
 */

export const DOCUMENT_TYPES = [
  'passport',
  'transcript',
  'degree_certificate',
  'language_test',
  'personal_statement',
  'reference_letter',
  'cv',
  'financial_evidence',
  'portfolio',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Scan states.
 *
 * `pending` and `failed` are deliberately distinct: pending means we have not
 * finished looking, failed means the scanner errored and we still do not know.
 * Neither is `clean`, and the difference matters when telling a student why
 * their file is not usable yet.
 */
export const SCAN_STATES = ['pending', 'clean', 'quarantined', 'failed'] as const;
export type ScanState = (typeof SCAN_STATES)[number];

export const DocumentVersionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  /** Monotonic per document. Version 1 is never reused or renumbered. */
  version: z.number().int().min(1),
  /** Opaque object-storage key. Carries no filename — a bucket listing must
   *  not reveal who applied where. */
  objectKey: z.string(),
  /** SHA-256 of the bytes actually stored, computed after the upload settles. */
  checksum: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  contentType: z.string().nullable(),
  scanState: z.enum(SCAN_STATES),
  scannedAt: z.iso.datetime().nullable(),
  /** What the scanner said, for the student and for the audit trail. */
  scanDetail: z.string().nullable(),
  /** False until the checksum matches and the upload is known to be complete. */
  uploadComplete: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const DocumentSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: z.enum(DOCUMENT_TYPES),
  /** What the student called it. Shown in the vault, never used as an object key. */
  displayName: z.string().min(1),
  currentVersionId: z.string().nullable(),
  /** Passports and language tests expire; the vault reminds before they do. */
  expiryAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Document = z.infer<typeof DocumentSchema>;

/**
 * **The connector boundary predicate.** Fail-closed by construction: it names
 * the one state that passes rather than listing the states that do not, so a
 * scan state added later is refused until somebody decides otherwise.
 *
 * `uploadComplete` is checked too. A version whose row exists but whose bytes
 * never landed has a `pending` scan and no checksum; without this it would be
 * exactly one scanner bug away from looking acceptable.
 */
export function isConnectorEligible(version: DocumentVersion): boolean {
  return version.scanState === 'clean' && version.uploadComplete && version.checksum !== null;
}

/** Why a version cannot be sent, in words a student reads. `null` when it can. */
export function connectorBlockReason(version: DocumentVersion): string | null {
  if (isConnectorEligible(version)) return null;
  if (!version.uploadComplete) return 'This upload did not finish. Upload the file again.';
  switch (version.scanState) {
    case 'pending':
      return 'We are still checking this file for malware. This usually takes under a minute.';
    case 'quarantined':
      return 'This file was blocked because our malware scan flagged it. It cannot be used in an application. Upload a clean copy.';
    case 'failed':
      return 'Our malware scan could not finish on this file, so we cannot use it yet. Try uploading it again.';
    case 'clean':
      // Clean but missing a checksum: the upload settled without verification.
      return 'We could not verify this file after upload. Upload it again.';
  }
}

/**
 * A quarantined version is blocked **permanently**. There is no path back to
 * `clean` for the same bytes, and the UI says so rather than implying a retry
 * on this version might work.
 */
export function isPermanentlyBlocked(version: DocumentVersion): boolean {
  return version.scanState === 'quarantined';
}

export const DOCUMENT_EXPIRY_WARNING_DAYS = 90;

export type ExpiryState = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';

export function expiryState(
  document: Pick<Document, 'expiryAt'>,
  now: Date = new Date(),
): ExpiryState {
  if (document.expiryAt === null) return 'no_expiry';
  const expiry = new Date(document.expiryAt);
  if (expiry <= now) return 'expired';
  const warningFrom = new Date(expiry);
  warningFrom.setUTCDate(warningFrom.getUTCDate() - DOCUMENT_EXPIRY_WARNING_DAYS);
  return warningFrom <= now ? 'expiring_soon' : 'valid';
}

/** Document types whose expiry we chase. Others may carry one; we do not remind. */
export const EXPIRING_DOCUMENT_TYPES: readonly DocumentType[] = Object.freeze([
  'passport',
  'language_test',
  'financial_evidence',
]);
