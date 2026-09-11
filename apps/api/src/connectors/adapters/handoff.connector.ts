import { createHmac, randomUUID } from 'node:crypto';
import type { ConnectorType, SubmissionOutcome } from '@modex/contracts';
import type { ConnectorPort, ConnectorRequest, SecretResolver } from '../connector.port.js';

/**
 * Secure portal handoff and deep-link continuation.
 *
 * One class for two connector types because they differ in exactly one thing —
 * whether the destination authenticates the student (portal SSO) or merely
 * carries their details across (deep link) — and that difference is a URL
 * template, not a protocol.
 *
 * Neither can confirm receipt. Both return `handoff_required`, which leaves the
 * application in `submitted_pending` with the copy "Sending to …". A student
 * sent to a university portal has **not** submitted anything yet, and the
 * temptation to call this done is the single easiest way to do real harm in
 * this product.
 */
export class HandoffConnector implements ConnectorPort {
  constructor(
    readonly type: Extract<ConnectorType, 'portal_handoff' | 'deep_link'>,
    private readonly secrets: SecretResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(request: ConnectorRequest): Promise<SubmissionOutcome> {
    if (request.endpointUrl === null) {
      return {
        status: 'rejected',
        code: 'connector_misconfigured',
        message: 'This university has no continuation URL configured.',
        fieldErrors: [],
      };
    }

    const handoffRef = `hof_${randomUUID()}`;
    const ttlSeconds = readTtl(request.settings);
    const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1000);

    const url = new URL(request.endpointUrl);
    url.searchParams.set('ref', handoffRef);
    // The partner quotes this back on the callback, so the confirmation is
    // attributable to one application rather than to "somebody who arrived".
    url.searchParams.set('modexApplication', request.applicationId);
    url.searchParams.set('expires', String(Math.floor(expiresAt.getTime() / 1000)));

    const credential = this.secrets.resolve(request.credentialRef);
    if (credential !== null) {
      // Signed so the partner can tell a real handoff from a crafted link. The
      // signature covers the expiry, so a captured link dies with it.
      url.searchParams.set(
        'sig',
        createHmac('sha256', credential)
          .update(`${handoffRef}.${request.applicationId}.${url.searchParams.get('expires')}`)
          .digest('hex'),
      );
    }

    return {
      status: 'handoff_required',
      continuationUrl: url.toString(),
      handoffRef,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

function readTtl(settings: Record<string, unknown>): number {
  const raw = settings.handoffTtlSeconds;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.min(Math.round(raw), 60 * 60 * 24)
    : 60 * 60;
}
