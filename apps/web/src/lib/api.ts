import type { Provenance, SyncState, VerificationClaim } from '@modex/contracts';

/**
 * Server-side API client for the SSR pages.
 *
 * Public catalogue pages are server-rendered for SEO (Phase 1 design spec), so
 * this runs on the server and never in the browser. The correlation header is
 * forwarded so a slow public page can be traced back through the API to the
 * catalogue query that made it slow.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3001';

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
  const response = await fetch(`${API_ORIGIN}/v1${path}`, {
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
