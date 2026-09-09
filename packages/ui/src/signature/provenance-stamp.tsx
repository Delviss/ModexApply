import type { Provenance, SyncState } from '@modex/contracts';
import { formatDate, formatRelative } from '../lib/format.js';
import { cn } from '../lib/cn.js';
import { AlertTriangleIcon } from '../primitives/icons.js';

/**
 * `<ProvenanceStamp>` — "Source updated · Verified · Expires" on every catalogue
 * and offer record (Phase 0 §2.9, Phase 1 design spec).
 *
 * Small, permanent, and never hidden behind a tooltip alone: a student deciding
 * whether to trust a tuition figure should not have to hover to learn it was
 * last confirmed eight months ago. A stale record renders in `--mx-warning-text`
 * with an icon, so the state survives greyscale and colour blindness.
 */

const SYNC_LABELS: Record<SyncState, string> = {
  synced: 'In sync with the university',
  stale: 'Not confirmed recently',
  pending_review: 'Awaiting university review',
  manual: 'Entered manually and reviewed',
  failed: 'Last sync failed',
};

export interface ProvenanceStampProps {
  provenance: Provenance;
  /** Fields whose staleness is blocking, listed for the reader. */
  staleFields?: readonly string[];
  now?: Date;
  className?: string;
}

export function ProvenanceStamp({
  provenance,
  staleFields = [],
  now = new Date(),
  className,
}: ProvenanceStampProps) {
  const expired =
    provenance.expiresAt !== null && new Date(provenance.expiresAt) <= now;
  const stale = provenance.syncState === 'stale' || provenance.syncState === 'failed' || expired;

  return (
    <p className={cn('mx-provenance', className)} data-stale={stale}>
      {stale ? (
        <span className="mx-provenance__item">
          <AlertTriangleIcon size={12} />
        </span>
      ) : null}

      <span className="mx-provenance__item">
        <span className="mx-provenance__label">Source updated</span>
        <span className="mx-provenance__value">
          {provenance.sourceUpdatedAt !== null
            ? `${formatDate(provenance.sourceUpdatedAt)} (${formatRelative(provenance.sourceUpdatedAt, now)})`
            : 'never recorded'}
        </span>
      </span>

      <span className="mx-provenance__item">
        <span className="mx-provenance__label">Verified</span>
        <span className="mx-provenance__value">
          {provenance.verifiedAt !== null ? formatDate(provenance.verifiedAt) : 'not verified'}
        </span>
      </span>

      <span className="mx-provenance__item">
        <span className="mx-provenance__label">{expired ? 'Expired' : 'Expires'}</span>
        <span className="mx-provenance__value">
          {provenance.expiresAt !== null ? formatDate(provenance.expiresAt) : 'no expiry set'}
        </span>
      </span>

      <span className="mx-provenance__item">
        <span className="mx-provenance__value">{SYNC_LABELS[provenance.syncState]}</span>
      </span>

      {provenance.reviewedBy !== null ? (
        <span className="mx-provenance__item">
          <span className="mx-provenance__label">Reviewed by</span>
          <span className="mx-provenance__value">{provenance.reviewedBy}</span>
        </span>
      ) : null}

      {staleFields.length > 0 ? (
        <span className="mx-provenance__item">
          <span className="mx-provenance__label">Unconfirmed fields:</span>
          <span className="mx-provenance__value">{staleFields.join(', ')}</span>
        </span>
      ) : null}
    </p>
  );
}
