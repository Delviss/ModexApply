import { z } from 'zod';

/**
 * Every catalogue and offer record carries provenance (Phase 1 §3). A record
 * whose freshness SLA has lapsed goes `stale` — it is never quietly served as
 * current (Phase 1 §4).
 */
export const SYNC_STATES = ['synced', 'stale', 'pending_review', 'manual', 'failed'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const ProvenanceSchema = z.object({
  /** When the *institution's* source last changed — not when we imported it. */
  sourceUpdatedAt: z.iso.datetime().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  syncState: z.enum(SYNC_STATES),
  /** Free-text pointer to the origin: feed name, file name, or reviewer note. */
  sourceRef: z.string().nullable(),
  /** Named human who signed the record off, for the manual-entry path. */
  reviewedBy: z.string().nullable(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Field-severity model (Phase 1 §4): a stale tuition figure or deadline *hides*
 * the record; a stale course description only warns. Severity is a property of
 * the field, so it lives with the contract rather than in a UI conditional.
 */
export const FIELD_SEVERITY = {
  blocking: [
    'tuitionFee',
    'applicationFee',
    'deposit',
    'applicationDeadline',
    'intakeStartDate',
    'requirements',
  ],
  warning: ['description', 'duration', 'campusName', 'field', 'level'],
} as const;

export type FieldSeverity = keyof typeof FIELD_SEVERITY;

export function severityForField(field: string): FieldSeverity | 'none' {
  if ((FIELD_SEVERITY.blocking as readonly string[]).includes(field)) return 'blocking';
  if ((FIELD_SEVERITY.warning as readonly string[]).includes(field)) return 'warning';
  return 'none';
}

/** Freshness SLAs in hours, by record kind. Breach flips `syncState` to `stale`. */
export const FRESHNESS_SLA_HOURS: Readonly<Record<string, number>> = Object.freeze({
  program: 24 * 30,
  intake: 24 * 7,
  requirement: 24 * 30,
  fee: 24 * 14,
  offer: 24 * 7,
});

export function isStale(
  provenance: Pick<Provenance, 'sourceUpdatedAt' | 'expiresAt'>,
  kind: string,
  now: Date = new Date(),
): boolean {
  if (provenance.expiresAt !== null && new Date(provenance.expiresAt) <= now) return true;
  const slaHours = FRESHNESS_SLA_HOURS[kind];
  if (slaHours === undefined || provenance.sourceUpdatedAt === null) return false;
  const ageMs = now.getTime() - new Date(provenance.sourceUpdatedAt).getTime();
  return ageMs > slaHours * 60 * 60 * 1000;
}

/**
 * Whether a stale record may still be shown publicly. Blocking fields being
 * stale hides the record; only warning-level staleness stays visible with a
 * `--mx-warning` provenance stamp.
 */
export function publicVisibility(
  syncState: SyncState,
  staleFields: readonly string[],
): 'visible' | 'visible_with_warning' | 'hidden' {
  if (syncState === 'failed') return 'hidden';
  if (staleFields.some((f) => severityForField(f) === 'blocking')) return 'hidden';
  if (syncState === 'stale' || staleFields.length > 0) return 'visible_with_warning';
  return 'visible';
}
