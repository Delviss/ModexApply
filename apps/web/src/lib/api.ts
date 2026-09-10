import type { Provenance, SyncState, VerificationClaim } from '@modex/contracts';

/**
 * Server-side API client for the SSR pages.
 *
 * Public catalogue pages are server-rendered for SEO (Phase 1 design spec), so
 * this runs on the server and never in the browser. The correlation header is
 * forwarded so a slow public page can be traced back through the API to the
 * catalogue query that made it slow.
 */
/**
 * Where the API lives.
 *
 * Read from `API_ORIGIN`, deliberately *not* `NEXT_PUBLIC_API_ORIGIN`. Next
 * inlines `NEXT_PUBLIC_*` into the bundle at build time, which would mean:
 *
 *   1. The same artefact could not be promoted from staging to production —
 *      each environment would need its own build, which is incompatible with
 *      the blue/green deploys Phase 0 section 3.1 calls for.
 *   2. A server-only base URL would be shipped to every browser for no reason.
 *
 * Resolved per call rather than at module scope, so a value supplied by the
 * orchestrator at start-up is picked up without a rebuild. The public fallback
 * is kept so an existing deployment does not break on upgrade.
 */
function apiOrigin(): string {
  return process.env.API_ORIGIN ?? process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3001';
}

export const DEFAULT_REVALIDATE_SECONDS = 60;

/**
 * Read window for anything showing a fee or a deadline.
 *
 * "A wrong price is worse than an absent one" is the rule the freshness model
 * exists to enforce, and a long cache would quietly undo it: the sweep hides the
 * record, and the edge keeps serving the old figure until the entry expires.
 */
export const MONEY_REVALIDATE_SECONDS = 15;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(
  path: string,
  options: { correlationId?: string; revalidate?: number } = {},
): Promise<T> {
  const response = await fetch(`${apiOrigin()}/v1${path}`, {
    headers: {
      accept: 'application/json',
      ...(options.correlationId === undefined ? {} : { 'x-correlation-id': options.correlationId }),
    },
    // Cached briefly. The window is a real trade-off, not a default: when the
    // freshness sweep pulls a programme for a stale tuition figure, the old
    // price stays servable for exactly this long. Pages that carry money pass
    // MONEY_REVALIDATE_SECONDS; pages that do not can afford the longer window.
    next: { revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
      | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'internal_error',
      body?.error?.message ?? 'The request failed.',
      body?.error?.details,
    );
  }

  return (await response.json()) as T;
}

/**
 * ---------------------------------------------------------------------------
 * Authenticated requests
 * ---------------------------------------------------------------------------
 *
 * **The most dangerous line in this file is a missing one.** `apiGet` above
 * always sets `next: { revalidate }`, which is correct for the public catalogue
 * and catastrophic for anything owner-scoped: Next's data cache is keyed on the
 * URL, not on the session, so one student's profile response would be served to
 * the next student who asked for `/v1/me/profile`.
 *
 * So the authenticated helpers below are separate functions rather than an
 * option on the existing one, and every path through them sets
 * `cache: 'no-store'` with no way to override it. There is no parameter to
 * forget.
 */

/** Never cached, and there is deliberately no argument that could change that. */
const NEVER_CACHED = { cache: 'no-store' } as const satisfies Pick<RequestInit, 'cache'>;

function authHeaders(token: string, correlationId?: string): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    ...(correlationId === undefined ? {} : { 'x-correlation-id': correlationId }),
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    | null;
  return new ApiError(
    response.status,
    body?.error?.code ?? 'internal_error',
    body?.error?.message ?? 'The request failed.',
    body?.error?.details,
  );
}

/** A read on behalf of a signed-in student. Never cached. */
export async function apiGetAs<T>(
  path: string,
  token: string,
  options: { correlationId?: string } = {},
): Promise<T> {
  const response = await fetch(`${apiOrigin()}/v1${path}`, {
    headers: authHeaders(token, options.correlationId),
    ...NEVER_CACHED,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/** A write on behalf of a signed-in student. Never cached. */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
  options: { correlationId?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const response = await fetch(`${apiOrigin()}/v1${path}`, {
    method,
    headers: {
      ...authHeaders(token, options.correlationId),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': options.idempotencyKey }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...NEVER_CACHED,
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Shapes the public pages consume. Mirrors the API projections. */
export interface PublicInstitution {
  id: string;
  displayName: string;
  country: string;
  domains: string[];
  websiteUrl: string | null;
  description: string | null;
  verificationState: VerificationClaim['state'];
  verificationStage: string | null;
  canDisplayVerifiedBadge: boolean;
  verificationPipeline: { stage: string; status: 'pending' | 'active' | 'done' | 'error' }[];
  campuses: { id: string; name: string; city: string; country: string }[];
  partnerships: { scopes: string[]; startDate: string | null; endDate: string | null; status: string }[];
}

export interface PublicProgramme {
  program: {
    id: string;
    programKey: string;
    name: string;
    level: string;
    field: string;
    durationMonths: number;
    studyMode: string;
    description: string | null;
    version: number;
    effectiveFrom: string;
    sourceUpdatedAt: string | null;
    verifiedAt: string | null;
    expiresAt: string | null;
    syncState: SyncState;
    sourceRef: string | null;
    reviewedBy: string | null;
    staleFields: string[];
    institution: { id: string; displayName: string; country: string; verificationState: string; verificationStage: string | null };
    campus: { name: string; city: string; country: string } | null;
    requirements: {
      id: string;
      ruleType: string;
      humanSummary: string;
      sourceRef: string;
      ruleJson: unknown;
    }[];
    fees: {
      tuitionMinor: number;
      tuitionCurrency: string;
      applicationFeeMinor: number | null;
      applicationFeeCurrency: string | null;
      depositMinor: number | null;
      depositCurrency: string | null;
      sourceUpdatedAt: string | null;
      verifiedAt: string | null;
      expiresAt: string | null;
      syncState: SyncState;
      sourceRef: string | null;
      reviewedBy: string | null;
    }[];
  };
  visibility: 'visible' | 'visible_with_warning';
  intakes: {
    id: string;
    startDate: string;
    applicationDeadline: string;
    status: string;
    capacity: number | null;
    sourceUpdatedAt: string | null;
    verifiedAt: string | null;
    expiresAt: string | null;
    syncState: SyncState;
    sourceRef: string | null;
    reviewedBy: string | null;
  }[];
}

/** Lifts the provenance columns off any record into the shape the stamp takes. */
export function toProvenance(record: {
  sourceUpdatedAt: string | Date | null;
  verifiedAt: string | Date | null;
  expiresAt: string | Date | null;
  syncState: SyncState;
  sourceRef: string | null;
  reviewedBy: string | null;
}): Provenance {
  const iso = (value: string | Date | null) =>
    value === null ? null : typeof value === 'string' ? value : value.toISOString();
  return {
    sourceUpdatedAt: iso(record.sourceUpdatedAt),
    verifiedAt: iso(record.verifiedAt),
    expiresAt: iso(record.expiresAt),
    syncState: record.syncState,
    sourceRef: record.sourceRef,
    reviewedBy: record.reviewedBy,
  };
}
