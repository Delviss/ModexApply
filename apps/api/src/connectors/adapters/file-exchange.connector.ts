import { canonicalJson, type ConnectorType, type SubmissionOutcome } from '@modex/contracts';
import type { StorageService } from '../../storage/storage.service.js';
import type { ConnectorPort, ConnectorRequest } from '../connector.port.js';

/**
 * Structured file exchange — a secure package a partner collects on a schedule.
 *
 * Writes the package and returns `queued`, never `accepted`. The batch
 * reference is Modex's, not the university's, and a Modex-generated reference
 * is not a receipt: confirmation arrives later as an inbound status event
 * carrying *their* reference, and that is what moves the application to
 * `submitted`.
 *
 * The package body is the canonical payload, so what lands in the bucket is
 * byte-identical to what the snapshot hashes. A partner reading the package and
 * an auditor reading the snapshot are reading the same bytes.
 */
export class FileExchangeConnector implements ConnectorPort {
  readonly type: ConnectorType = 'file_exchange';

  constructor(
    private readonly storage: StorageService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(request: ConnectorRequest): Promise<SubmissionOutcome> {
    const batchRef = `batch_${request.applicationId}_${request.attemptNo}`;
    const key = this.storage.buildKey('connector-packages', request.applicationId);

    await this.storage.putObject(
      key,
      Buffer.from(
        canonicalJson({
          batchRef,
          idempotencyKey: request.idempotencyKey,
          application: request.payload,
          documents: request.documents.map((document) => ({
            type: document.type,
            checksum: document.checksum,
            contentType: document.contentType,
            sizeBytes: document.sizeBytes,
            fetchUrl: document.fetchUrl,
          })),
        }),
        'utf8',
      ),
      'application/json',
    );

    const expectedHours = readExpectedHours(request.settings);
    return {
      status: 'queued',
      batchRef,
      expectedBy: new Date(this.now().getTime() + expectedHours * 3600_000).toISOString(),
    };
  }
}

function readExpectedHours(settings: Record<string, unknown>): number {
  const raw = settings.expectedConfirmationHours;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(raw, 168) : 24;
}
