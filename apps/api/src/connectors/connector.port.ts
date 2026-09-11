import type {
  ApplicationPayload,
  ConnectorType,
  SubmissionOutcome,
} from '@modex/contracts';

/**
 * The adapter boundary (Phase 4 §3, FR-010).
 *
 * Everything university-specific lives behind this interface. The core knows
 * five connector *shapes* and a configuration row; it does not know that one
 * partner wants `applicantRef` and another wants `student_number`, and it must
 * never learn.
 *
 * Two things are deliberately absent from `ConnectorRequest`:
 *
 *  1. **Document bytes and object keys.** An adapter receives resolved
 *     documents — id, checksum, content type and a short-lived fetch handle —
 *     because `DocumentsService.resolveForConnector` has already refused
 *     anything unscanned. An adapter that could reach into storage itself would
 *     be an adapter that could bypass the one guarantee Phase 2 exists to make.
 *  2. **The student's access context.** An adapter cannot re-read the database,
 *     cannot widen its own scope, and cannot decide it needs one more field.
 *     What it is given is what was consented to.
 */
export interface ResolvedDocument {
  documentId: string;
  versionId: string;
  type: string;
  checksum: string;
  sizeBytes: number | null;
  contentType: string | null;
  /**
   * Short-lived, single-purpose URL the partner may fetch the bytes from.
   *
   * Issued by `StorageService`, capped at 900 seconds there. The adapter passes
   * it on; it never reads the object itself, which keeps the bytes out of this
   * process entirely for every connector that can fetch.
   */
  fetchUrl: string;
  fetchUrlExpiresAt: string;
}

export interface ConnectorRequest {
  applicationId: string;
  /** Sent to the partner so a retry cannot create a second application there. */
  idempotencyKey: string;
  attemptNo: number;
  correlationId: string;
  payload: ApplicationPayload;
  documents: readonly ResolvedDocument[];
  /** The partner's own configuration. Opaque to the core. */
  settings: Record<string, unknown>;
  endpointUrl: string | null;
  /** Name of the credential in the secret store, resolved by the adapter. */
  credentialRef: string | null;
  /** Present only for `operator_assisted`. */
  operator?: { userId: string; displayName: string };
}

export interface ConnectorPort {
  readonly type: ConnectorType;
  /**
   * Hands the payload to the university.
   *
   * Returns an outcome; throws only on a programming error. A network failure
   * is `retryable_failure`, a partner's "no" is `rejected`, and neither is an
   * exception — both are things the student needs told, and an exception is a
   * poor way to carry a sentence a student reads.
   */
  submit(request: ConnectorRequest): Promise<SubmissionOutcome>;

  /**
   * Asks the partner for the current status of one submission.
   *
   * Only connectors without webhooks implement this meaningfully; the rest
   * return an empty list and the poll job skips them.
   */
  poll?(request: {
    externalRef: string;
    endpointUrl: string | null;
    credentialRef: string | null;
    settings: Record<string, unknown>;
  }): Promise<PolledStatus[]>;
}

export interface PolledStatus {
  providerEventId: string;
  externalRef: string;
  kind: import('@modex/contracts').InboundStatusKind;
  occurredAt: string;
  detail: Record<string, unknown>;
}

/** Injection token for the set of adapters registered in this deployment. */
export const CONNECTOR_ADAPTERS = Symbol('CONNECTOR_ADAPTERS');

/**
 * Where an adapter reads its credential.
 *
 * A named lookup rather than a value on the configuration row: the connector
 * table is read by ops tooling and dumped in backups, and a partner's API key
 * in a column is a partner's API key in a backup.
 */
export interface SecretResolver {
  resolve(ref: string | null): string | null;
}

export const SECRET_RESOLVER = Symbol('SECRET_RESOLVER');

/**
 * Environment-backed secrets: `MODEX_SECRET_<REF>`, uppercased with
 * non-alphanumerics folded to underscores. Enough for the pilot, and the seam
 * a real secret manager implements without touching an adapter.
 */
export class EnvSecretResolver implements SecretResolver {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  resolve(ref: string | null): string | null {
    if (ref === null || ref.trim() === '') return null;
    const key = `MODEX_SECRET_${ref.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
    return this.env[key] ?? null;
  }
}
