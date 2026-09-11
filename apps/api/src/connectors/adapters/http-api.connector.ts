import { Logger } from '@nestjs/common';
import {
  InboundStatusEventSchema,
  SubmissionOutcomeSchema,
  type ConnectorType,
  type SubmissionOutcome,
} from '@modex/contracts';
import type {
  ConnectorPort,
  ConnectorRequest,
  PolledStatus,
  SecretResolver,
} from '../connector.port.js';

/**
 * The API connector — the target for the pilot partner.
 *
 * The only shape that can return a durable reference synchronously, which makes
 * it the only one where "submitted" and "the call returned" can coincide. Even
 * here they do not coincide automatically: a 200 with no reference in it is
 * `retryable_failure`, not success. A partner who accepted the application but
 * could not say so has given us nothing we can show a student.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpApiConnector implements ConnectorPort {
  readonly type: ConnectorType = 'api';
  private readonly logger = new Logger(HttpApiConnector.name);

  constructor(
    private readonly secrets: SecretResolver,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async submit(request: ConnectorRequest): Promise<SubmissionOutcome> {
    if (request.endpointUrl === null) {
      return {
        status: 'rejected',
        code: 'connector_misconfigured',
        message: 'This university has no application endpoint configured.',
        fieldErrors: [],
      };
    }

    const credential = this.secrets.resolve(request.credentialRef);
    const timeoutMs = readTimeout(request.settings);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(request.endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          // The partner's own duplicate guard. The platform record in
          // `idempotency_records` stops a duplicate *request*; this is what
          // stops a duplicate *application at the university*.
          'idempotency-key': request.idempotencyKey,
          'x-correlation-id': request.correlationId,
          ...(credential === null ? {} : { authorization: `Bearer ${credential}` }),
        },
        body: JSON.stringify({
          application: request.payload,
          documents: request.documents.map((document) => ({
            type: document.type,
            checksum: document.checksum,
            contentType: document.contentType,
            sizeBytes: document.sizeBytes,
            fetchUrl: document.fetchUrl,
            fetchUrlExpiresAt: document.fetchUrlExpiresAt,
          })),
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (response.status >= 500 || response.status === 429) {
        return {
          status: 'retryable_failure',
          reason: `the university returned ${response.status}`,
          retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
        };
      }

      if (!response.ok) {
        return {
          status: 'rejected',
          code: String(body?.code ?? `http_${response.status}`),
          message: String(body?.message ?? 'The university rejected the application.'),
          fieldErrors: parseFieldErrors(body?.fieldErrors),
        };
      }

      const externalRef = firstString(body, ['externalRef', 'reference', 'applicationNumber']);
      if (externalRef === null) {
        // Accepted-looking, but unprovable. Treated as retryable rather than as
        // success: telling a student "submitted" on the strength of a 200 with
        // an empty body is exactly the harm this phase exists to prevent.
        this.logger.warn(
          `Connector returned ${response.status} with no reference for application ${request.applicationId}`,
        );
        return {
          status: 'retryable_failure',
          reason: 'the university accepted the request but returned no reference',
          retryAfterSeconds: null,
        };
      }

      return SubmissionOutcomeSchema.parse({
        status: 'accepted',
        externalRef,
        receivedAt: firstString(body, ['receivedAt']) ?? new Date().toISOString(),
        evidence: body ?? {},
      });
    } catch (error) {
      // Includes the abort: a timeout is a retryable failure and leaves the
      // application in `submitted_pending`, because we genuinely do not know
      // whether the university has it.
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `no response within ${Math.round(timeoutMs / 1000)}s`
          : error instanceof Error
            ? error.message
            : 'the connection failed';
      return { status: 'retryable_failure', reason, retryAfterSeconds: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async poll(request: {
    externalRef: string;
    endpointUrl: string | null;
    credentialRef: string | null;
    settings: Record<string, unknown>;
  }): Promise<PolledStatus[]> {
    const statusUrl = typeof request.settings.statusUrl === 'string' ? request.settings.statusUrl : null;
    if (statusUrl === null) return [];

    const credential = this.secrets.resolve(request.credentialRef);
    const response = await this.fetchImpl(
      `${statusUrl}?reference=${encodeURIComponent(request.externalRef)}`,
      {
        headers: {
          accept: 'application/json',
          ...(credential === null ? {} : { authorization: `Bearer ${credential}` }),
        },
      },
    );
    if (!response.ok) return [];

    const body = (await response.json().catch(() => null)) as { events?: unknown[] } | null;
    const events = Array.isArray(body?.events) ? body.events : [];
    // A malformed event from a partner is dropped rather than thrown: one bad
    // row must not stop the good ones in the same response from being applied.
    return events.flatMap((event) => {
      const parsed = InboundStatusEventSchema.safeParse(event);
      return parsed.success ? [parsed.data as PolledStatus] : [];
    });
  }
}

function readTimeout(settings: Record<string, unknown>): number {
  const raw = settings.timeoutMs;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.round(seconds), 3600) : null;
}

function firstString(body: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (body === null) return null;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function parseFieldErrors(raw: unknown): { field: string; message: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const field = (entry as Record<string, unknown>).field;
    const message = (entry as Record<string, unknown>).message;
    return typeof field === 'string' && typeof message === 'string' ? [{ field, message }] : [];
  });
}
