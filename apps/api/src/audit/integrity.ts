import { createHash } from 'node:crypto';

/**
 * Hash chain over the audit log.
 *
 * The application has no delete path and the database revokes DELETE, but a
 * sufficiently privileged operator at the storage layer still could remove a
 * row. Chaining each event to its predecessor makes that removal *detectable*:
 * the chain no longer verifies from the genesis event forward.
 *
 * This is tamper evidence, not tamper prevention. Saying which one you have is
 * the whole point of the control.
 */
export const GENESIS_INTEGRITY_REF =
  '0000000000000000000000000000000000000000000000000000000000000000';

export interface ChainableEvent {
  actorId: string | null;
  actorType: string;
  action: string;
  objectType: string;
  objectId: string;
  timestamp: Date | string;
  correlationId: string;
  metadata: unknown;
}

export function computeIntegrityRef(event: ChainableEvent, previousRef: string): string {
  const timestamp =
    typeof event.timestamp === 'string' ? event.timestamp : event.timestamp.toISOString();
  const payload = [
    previousRef,
    event.actorId ?? '',
    event.actorType,
    event.action,
    event.objectType,
    event.objectId,
    timestamp,
    event.correlationId,
    stableStringify(event.metadata),
  ].join(' ');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Verifies a chain in timestamp order. Returns the first break, if any. */
export function verifyChain(
  events: readonly (ChainableEvent & { integrityRef: string; id: string })[],
  startingRef: string = GENESIS_INTEGRITY_REF,
): { valid: boolean; brokenAtId: string | null } {
  let previous = startingRef;
  for (const event of events) {
    const expected = computeIntegrityRef(event, previous);
    if (expected !== event.integrityRef) return { valid: false, brokenAtId: event.id };
    previous = event.integrityRef;
  }
  return { valid: true, brokenAtId: null };
}

/** Key order must not change the hash, or the chain breaks on a refactor. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
