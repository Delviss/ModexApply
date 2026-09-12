'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Select,
  formatDate,
  type Column,
} from '@modex/ui';
import {
  OFFER_TYPE_LABELS,
  formatOfferValue,
  type OfferPublicationState,
  type VerificationState,
} from '@modex/contracts';
import type { AdminOffer } from '@/lib/offers';

/**
 * The university's offer admin (Phase 5 design spec).
 *
 * Built on the `Team Members Data Table` archetype, with the status column
 * carrying the same verification vocabulary the student-facing badge uses — an
 * admin and an applicant must never read two different words for one state.
 *
 * The screen is opinionated about one thing: **publish is disabled, and what is
 * missing is named, until the offer is complete and Trust has verified it.** A
 * greyed button with no explanation would send an admin to support; a greyed
 * button that says "no named verifier, no last-checked date" sends them to the
 * thing they can actually fix. The API and a database CHECK constraint enforce
 * the same list, so this is the explanation rather than the control.
 *
 * The list sits behind a disclosure rather than inline, and that is a layout
 * decision with a reason: rendered open, seven blockers made one cell wider than
 * the table and drove the row past 800px, pushing the primary action off the
 * horizontal scroll. A count the admin can read at a glance, one click from the
 * detail, keeps the explanation without letting one draft offer dictate the
 * shape of every other row.
 */

const PUBLICATION_TONES: Record<OfferPublicationState, 'neutral' | 'success' | 'warning' | 'info'> = {
  draft: 'neutral',
  in_review: 'info',
  published: 'success',
  unpublished: 'warning',
  expired: 'warning',
};

/**
 * Badge labels. `in_review` reads "Not published" rather than "Verified, not
 * published": the verification state is already on the line directly beneath,
 * so the longer label repeated it — and, being the widest badge in the table,
 * it was setting the width of the whole Status column to say it twice.
 */
const PUBLICATION_LABELS: Record<OfferPublicationState, string> = {
  draft: 'Draft',
  in_review: 'Not published',
  published: 'Published',
  unpublished: 'Pulled',
  expired: 'Expired',
};

/** Reads naturally in a sentence, which the badge labels do not. */
const FILTER_LABELS: Record<OfferPublicationState, string> = {
  draft: 'draft',
  in_review: 'verified but unpublished',
  published: 'published',
  unpublished: 'pulled',
  expired: 'expired',
};

const VERIFICATION_LABELS: Record<VerificationState, string> = {
  unverified: 'Not verified',
  pending: 'Verification pending',
  verified: 'Verified',
  expired: 'Verification expired',
  revoked: 'Verification revoked',
};

export interface OfferAdminProps {
  rows: readonly AdminOffer[];
  onPublish?: (offerKey: string) => void;
  onUnpublish?: (offerKey: string) => void;
}

export function OfferAdmin({ rows, onPublish, onUnpublish }: OfferAdminProps) {
  const [filter, setFilter] = useState<'all' | OfferPublicationState>('all');

  const filtered = useMemo(
    () => rows.filter((row) => filter === 'all' || row.publicationState === filter),
    [rows, filter],
  );

  const columns: Column<AdminOffer>[] = [
    {
      id: 'name',
      header: 'Offer',
      value: (row) => `${row.name} ${row.offerKey} ${OFFER_TYPE_LABELS[row.type]}`,
      sortable: true,
      render: (row) => (
        <div>
          <strong>{row.name}</strong>
          <br />
          <span style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
            {OFFER_TYPE_LABELS[row.type]} · version {row.version} ·{' '}
            {row.programKey ?? 'every programme'}
          </span>
        </div>
      ),
    },
    {
      id: 'value',
      header: 'Value',
      value: (row) => formatOfferValue(row.value),
      render: (row) => formatOfferValue(row.value),
    },
    {
      id: 'status',
      header: 'Status',
      value: (row) => `${row.publicationState} ${row.verificationState}`,
      sortable: true,
      render: (row) => (
        <div className="mx-offer-admin__status">
          <Badge tone={PUBLICATION_TONES[row.publicationState]}>
            {PUBLICATION_LABELS[row.publicationState]}
          </Badge>
          <span>
            {VERIFICATION_LABELS[row.verificationState]}
            {row.verifiedBy === null ? '' : ` · ${row.verifiedBy}`}
          </span>
        </div>
      ),
    },
    {
      id: 'validity',
      header: 'Valid until',
      value: (row) => row.validUntil,
      sortable: true,
      render: (row) => (
        <span
          style={{
            color:
              row.expiryUrgency === 'urgent' || row.expiryUrgency === 'lapsed'
                ? 'var(--mx-danger-text)'
                : row.expiryUrgency === 'due'
                  ? 'var(--mx-warning-text)'
                  : undefined,
          }}
        >
          {formatDate(row.validUntil)}
        </span>
      ),
    },
    {
      id: 'lastChecked',
      header: 'Last checked',
      // Sorts oldest-first when ascending, and an unchecked offer sorts to the
      // very top: the queue is meant to surface exactly those.
      value: (row) => row.lastCheckedAt ?? '',
      sortable: true,
      render: (row) =>
        row.lastCheckedAt === null ? (
          // Never blank. A blank cell reads as "fine"; this reads as the gap it is.
          <span style={{ color: 'var(--mx-warning-text)' }}>Never checked</span>
        ) : (
          formatDate(row.lastCheckedAt)
        ),
    },
    {
      id: 'attached',
      // Short because the header is `white-space: nowrap` and this table has
      // seven columns: "On applications" cost 30px of width for one word.
      header: 'Applications',
      value: (row) => row.attachedApplications,
      sortable: true,
    },
    {
      id: 'actions',
      header: 'Actions',
      value: (row) => (row.blockers.length === 0 ? 'ready' : 'blocked'),
      render: (row) =>
        row.publicationState === 'published' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onUnpublish?.(row.offerKey)}
            disabled={onUnpublish === undefined}
          >
            Pull
          </Button>
        ) : (
          <div className="mx-offer-admin__actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onPublish?.(row.offerKey)}
              disabled={onPublish === undefined || row.blockers.length > 0}
            >
              Publish
            </Button>
            {row.blockers.length > 0 ? (
              <details className="mx-offer-admin__blockers">
                <summary>
                  {row.blockers.length} thing{row.blockers.length === 1 ? '' : 's'} to fix
                </summary>
                <ul>
                  {row.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <Card padding="lg">
      <CardHeader
        title="Offers"
        description="Scholarships, discounts, waivers and benefits published through Modex. An offer goes live only after Modex Trust has checked it against your own published terms."
      />

      <div style={{ margin: 'var(--mx-space-4) 0', maxWidth: 280 }}>
        <Select
          aria-label="Filter by status"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">All offers</option>
          <option value="draft">Draft</option>
          <option value="in_review">Verified, not published</option>
          <option value="published">Published</option>
          <option value="unpublished">Pulled</option>
          <option value="expired">Expired</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No offers yet' : `No ${FILTER_LABELS[filter]} offers`}
          description={
            filter === 'all'
              ? 'Create a draft offer, then send it to Modex Trust for verification. Nothing reaches a student until a named verifier has checked it against your published terms and recorded the date they did.'
              : 'Nothing in this state. Clear the filter to see the rest.'
          }
        />
      ) : (
        <DataTable
          caption="Offers published through Modex"
          columns={columns}
          rows={filtered}
          rowId={(row) => row.offerKey}
          searchPlaceholder="Search offers (try scholarship, waiver, a programme key)"
        />
      )}
    </Card>
  );
}
