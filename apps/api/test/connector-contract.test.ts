import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SUBMISSION_ATTEMPTS,
  attemptStateFor,
  connectorDescription,
  isReceipt,
  isRetryable,
  isSynchronousConnector,
  retryDelaySeconds,
  stateForInboundStatus,
  type ApplicationPayload,
  type ConnectorType,
} from '@modex/contracts';
import { signWebhook, verifyWebhook } from '../src/common/crypto/webhook-signature.js';
import { HttpApiConnector } from '../src/connectors/adapters/http-api.connector.js';
import { HandoffConnector } from '../src/connectors/adapters/handoff.connector.js';
import { FileExchangeConnector } from '../src/connectors/adapters/file-exchange.connector.js';
import { OperatorAssistedConnector } from '../src/connectors/adapters/operator-assisted.connector.js';
import type { ConnectorRequest, SecretResolver } from '../src/connectors/connector.port.js';

/**
 * Connector contract tests (acceptance criterion 8).
 *
 * Every adapter is driven against a recorded fixture rather than a live
 * partner, and the assertions are about the *contract* rather than about any
 * one university's JSON: which outcomes an adapter may return, and — the rule
 * the whole phase turns on — which of them count as a receipt.
 */

const secrets: SecretResolver = { resolve: (ref) => (ref === null ? null : `secret-for-${ref}`) };

const payload = {
  payloadVersion: 1,
  application: {
    id: 'app_1',
    programKey: 'prog_1',
    programId: 'p1',
    programVersion: 1,
    intakeId: 'i1',
    institutionId: 'inst_1',
  },
} as unknown as ApplicationPayload;

function request(overrides: Partial<ConnectorRequest> = {}): ConnectorRequest {
  return {
    applicationId: 'app_1',
    idempotencyKey: 'modex-app_1-1',
    attemptNo: 1,
    correlationId: 'corr_1',
    payload,
    documents: [],
    settings: {},
    endpointUrl: 'https://partner.example/applications',
    credentialRef: 'partner-api',
    ...overrides,
  };
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('the API connector', () => {
  it('returns a receipt when the partner gives a reference', async () => {
    const fetchImpl = vi.fn(async () =>
      response(201, { externalRef: 'OX-2026-0001', receivedAt: '2026-09-11T09:00:00.000Z' }),
    );
    const outcome = await new HttpApiConnector(secrets, fetchImpl as never).submit(request());

    expect(outcome.status).toBe('accepted');
    expect(isReceipt(outcome)).toBe(true);
    expect(attemptStateFor(outcome)).toBe('accepted');
  });

  it('sends the idempotency key the university dedupes on', async () => {
    const fetchImpl = vi.fn(async () => response(201, { externalRef: 'OX-1' }));
    await new HttpApiConnector(secrets, fetchImpl as never).submit(
      request({ idempotencyKey: 'modex-app_1-1' }),
    );

    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('modex-app_1-1');
    expect(headers.authorization).toBe('Bearer secret-for-partner-api');
  });

  it('treats a 200 with no reference as retryable, not as success', async () => {
    // The most dangerous partner response there is: everything looks fine and
    // there is nothing we could show a student as proof.
    const fetchImpl = vi.fn(async () => response(200, { ok: true }));
    const outcome = await new HttpApiConnector(secrets, fetchImpl as never).submit(request());

    expect(outcome.status).toBe('retryable_failure');
    expect(isReceipt(outcome)).toBe(false);
  });

  it('treats an empty-string reference as no reference', async () => {
    const fetchImpl = vi.fn(async () => response(201, { externalRef: '   ' }));
    const outcome = await new HttpApiConnector(secrets, fetchImpl as never).submit(request());
    expect(isReceipt(outcome)).toBe(false);
  });

  it('separates a partner saying no from a partner being unreachable', async () => {
    const rejected = await new HttpApiConnector(
      secrets,
      (async () => response(422, { code: 'missing_transcript', message: 'No transcript supplied.' })) as never,
    ).submit(request());
    expect(rejected.status).toBe('rejected');
    expect(isRetryable(rejected)).toBe(false);

    const unreachable = await new HttpApiConnector(
      secrets,
      (async () => response(503, {})) as never,
    ).submit(request());
    expect(unreachable.status).toBe('retryable_failure');
    expect(isRetryable(unreachable)).toBe(true);
  });

  it('honours a partner Retry-After rather than our own backoff', async () => {
    const outcome = await new HttpApiConnector(
      secrets,
      (async () => response(429, {}, { 'retry-after': '120' })) as never,
    ).submit(request());
    expect(outcome).toMatchObject({ status: 'retryable_failure', retryAfterSeconds: 120 });
  });

  it('turns a timeout into a retryable failure, never a rejection', async () => {
    // The chaos case: the connector went away mid-submission, and we do not
    // know whether the university has the application.
    const outcome = await new HttpApiConnector(
      secrets,
      (async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }) as never,
    ).submit(request({ settings: { timeoutMs: 5 } }));

    expect(outcome.status).toBe('retryable_failure');
    expect(isReceipt(outcome)).toBe(false);
  });

  it('refuses rather than guesses when no endpoint is configured', async () => {
    const outcome = await new HttpApiConnector(secrets).submit(request({ endpointUrl: null }));
    expect(outcome).toMatchObject({ status: 'rejected', code: 'connector_misconfigured' });
  });

  it('drops a malformed polled event without losing the good ones beside it', async () => {
    const outcome = await new HttpApiConnector(
      secrets,
      (async () =>
        response(200, {
          events: [
            { nonsense: true },
            {
              providerEventId: 'e1',
              externalRef: 'OX-1',
              kind: 'under_review',
              occurredAt: '2026-09-11T09:00:00.000Z',
            },
          ],
        })) as never,
    ).poll({
      externalRef: 'OX-1',
      endpointUrl: null,
      credentialRef: null,
      settings: { statusUrl: 'https://partner.example/status' },
    });

    expect(outcome).toHaveLength(1);
    expect(outcome[0]?.providerEventId).toBe('e1');
  });
});

describe('the handoff connectors', () => {
  it('never returns a receipt — a student sent to a portal has submitted nothing', async () => {
    for (const type of ['portal_handoff', 'deep_link'] as const) {
      const outcome = await new HandoffConnector(type, secrets).submit(
        request({ endpointUrl: 'https://partner.example/portal' }),
      );
      expect(outcome.status).toBe('handoff_required');
      expect(isReceipt(outcome)).toBe(false);
      expect(attemptStateFor(outcome)).toBe('awaiting_handoff');
    }
  });

  it('carries an attributable reference and an expiry on the continuation URL', async () => {
    const outcome = await new HandoffConnector('portal_handoff', secrets).submit(request());
    if (outcome.status !== 'handoff_required') throw new Error('expected a handoff');

    const url = new URL(outcome.continuationUrl);
    expect(url.searchParams.get('ref')).toBe(outcome.handoffRef);
    expect(url.searchParams.get('modexApplication')).toBe('app_1');
    // Signed, so the partner can tell a real handoff from a crafted link.
    expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(outcome.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('omits the signature rather than signing with nothing', async () => {
    const outcome = await new HandoffConnector('deep_link', secrets).submit(
      request({ credentialRef: null }),
    );
    if (outcome.status !== 'handoff_required') throw new Error('expected a handoff');
    expect(new URL(outcome.continuationUrl).searchParams.get('sig')).toBeNull();
  });
});

describe('the file-exchange connector', () => {
  it('queues a package and does not call it a receipt', async () => {
    const written = new Map<string, Buffer>();
    const storage = {
      buildKey: () => 'connector-packages/abc/1',
      putObject: async (key: string, body: Buffer) => {
        written.set(key, body);
      },
    };

    const outcome = await new FileExchangeConnector(storage as never).submit(request());
    expect(outcome.status).toBe('queued');
    expect(isReceipt(outcome)).toBe(false);
    expect(attemptStateFor(outcome)).toBe('queued');

    // The package body is the canonical payload, so a partner reading the file
    // and an auditor reading the snapshot are reading the same bytes.
    const body = JSON.parse(written.get('connector-packages/abc/1')!.toString('utf8'));
    expect(body.application).toEqual(JSON.parse(JSON.stringify(payload)));
    expect(body.idempotencyKey).toBe('modex-app_1-1');
  });
});

describe('the operator-assisted connector', () => {
  it('cannot produce a receipt, however confident the operator is', async () => {
    const outcome = await new OperatorAssistedConnector().submit(
      request({ operator: { userId: 'ops_1', displayName: 'Sam Okafor' } }),
    );
    expect(outcome.status).toBe('queued');
    expect(isReceipt(outcome)).toBe(false);
  });

  it('refuses an unattributable submission', async () => {
    const outcome = await new OperatorAssistedConnector().submit(request());
    expect(outcome).toMatchObject({ status: 'rejected', code: 'operator_required' });
  });
});

describe('the connector contract itself', () => {
  it('only calls a non-empty accepted reference a receipt', () => {
    expect(
      isReceipt({ status: 'accepted', externalRef: 'X', receivedAt: new Date().toISOString(), evidence: {} }),
    ).toBe(true);
    expect(
      isReceipt({ status: 'accepted', externalRef: '  ', receivedAt: new Date().toISOString(), evidence: {} }),
    ).toBe(false);
    expect(isReceipt({ status: 'queued', batchRef: 'b', expectedBy: new Date().toISOString() })).toBe(
      false,
    );
  });

  it('backs off exponentially and caps, and gives up after a bounded number of tries', () => {
    const delays = Array.from({ length: MAX_SUBMISSION_ATTEMPTS }, (_, index) =>
      retryDelaySeconds(index + 1),
    );
    expect(delays).toEqual([30, 60, 120, 240, 480, 900]);
    // Capped, so a long outage does not schedule a retry a day out.
    expect(retryDelaySeconds(20)).toBe(900);
  });

  it('knows which connectors can confirm synchronously', () => {
    expect(isSynchronousConnector('api')).toBe(true);
    expect(isSynchronousConnector('file_exchange')).toBe(true);
    expect(isSynchronousConnector('portal_handoff')).toBe(false);
    expect(isSynchronousConnector('deep_link')).toBe(false);
    expect(isSynchronousConnector('operator_assisted')).toBe(false);
  });

  it('describes every route to the student before they commit to it', () => {
    const types: ConnectorType[] = [
      'api',
      'portal_handoff',
      'deep_link',
      'file_exchange',
      'operator_assisted',
    ];
    for (const type of types) {
      expect(connectorDescription(type, 'Anytown University')).toContain('Anytown University');
    }
    // The operator-assisted copy has to say a human does it and that it is
    // recorded; the exception is disclosed at the point of decision.
    expect(connectorDescription('operator_assisted', 'Anytown University')).toMatch(
      /Modex staff.*on your behalf/s,
    );
  });

  it('maps a partner vocabulary onto our states, and only "received" confirms', () => {
    expect(stateForInboundStatus('received')).toBe('submitted');
    expect(stateForInboundStatus('under_review')).toBe('under_review');
    expect(stateForInboundStatus('more_info_required')).toBe('more_info');
    expect(stateForInboundStatus('offer_made')).toBe('offer');
    expect(stateForInboundStatus('enrolled')).toBe('enrolled');
  });
});

describe('webhook signatures', () => {
  const secret = 'partner-signing-secret';
  const body = JSON.stringify({ providerEventId: 'e1' });
  const now = new Date('2026-09-11T09:00:00.000Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));

  it('accepts a correctly signed, fresh request', () => {
    const signature = signWebhook(secret, timestamp, body);
    expect(verifyWebhook(secret, timestamp, body, signature, now)).toEqual({ valid: true });
  });

  it('refuses a body that changed after signing', () => {
    const signature = signWebhook(secret, timestamp, body);
    const result = verifyWebhook(secret, timestamp, '{"providerEventId":"e2"}', signature, now);
    expect(result).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('refuses a replay from outside the window, even with a valid signature', () => {
    // The unique index on (connectorId, providerEventId) stops a duplicate; it
    // does not stop a captured request being replayed later under a new id.
    const signature = signWebhook(secret, timestamp, body);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(verifyWebhook(secret, timestamp, body, signature, later)).toEqual({
      valid: false,
      reason: 'stale_timestamp',
    });
  });

  it('refuses a signature made with another partner’s secret', () => {
    const signature = signWebhook('someone-elses-secret', timestamp, body);
    expect(verifyWebhook(secret, timestamp, body, signature, now).valid).toBe(false);
  });

  it('refuses a missing signature or an unparseable timestamp without throwing', () => {
    expect(verifyWebhook(secret, timestamp, body, '', now)).toEqual({
      valid: false,
      reason: 'malformed',
    });
    expect(verifyWebhook(secret, 'not-a-number', body, 'a'.repeat(64), now)).toEqual({
      valid: false,
      reason: 'malformed',
    });
    // A short signature must not reach `timingSafeEqual`, which throws on a
    // length mismatch.
    expect(verifyWebhook(secret, timestamp, body, 'short', now)).toEqual({
      valid: false,
      reason: 'bad_signature',
    });
  });
});
