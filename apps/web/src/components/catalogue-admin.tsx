'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Pagination,
  ProvenanceStamp,
  Select,
  formatDate,
  type Column,
} from '@modex/ui';
import { formatMoney, money, type SyncState } from '@modex/contracts';
import { toProvenance } from '@/lib/api';

/**
 * Catalogue admin (Phase 1 design spec): a data table with column visibility,
 * bulk row selection, a diff viewer for sync results and a side drawer for
 * record detail.
 *
 * Built on the `Team Members Data Table` archetype with `Flexi Filter Table`'s
 * configurable filter categories and the standard `Table Pagination` footer.
 * The sync-diff view uses the expandable-row pattern from `HeroUI Table`.
 */

export interface CatalogueRow {
  programKey: string;
  name: string;
  level: string;
  field: string;
  status: 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived';
  syncState: SyncState;
  version: number;
  sourceUpdatedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  sourceRef: string | null;
  reviewedBy: string | null;
  staleFields: string[];
  tuitionMinor: number | null;
  tuitionCurrency: string | null;
  nextDeadline: string | null;
}

export interface SyncDiffRow {
  externalRef: string;
  kind: 'create' | 'update' | 'unchanged' | 'error';
  changes: { field: string; before: string | null; after: string | null; severity: string }[];
  errors: string[];
}

export interface CatalogueAdminProps {
  rows: readonly CatalogueRow[];
  diff?: readonly SyncDiffRow[];
  onPublish?: (keys: string[]) => void;
  onUnpublish?: (keys: string[]) => void;
}

const STATUS_TONES = {
  published: 'success',
  in_review: 'warning',
  draft: 'neutral',
  unpublished: 'neutral',
  archived: 'neutral',
} as const;

const SYNC_TONES = {
  synced: 'success',
  stale: 'warning',
  pending_review: 'info',
  manual: 'neutral',
  failed: 'danger',
} as const;

export function CatalogueAdmin({ rows, diff = [], onPublish, onUnpublish }: CatalogueAdminProps) {
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [syncFilter, setSyncFilter] = useState('all');
  const [pageSize, setPageSize] = useState(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [detail, setDetail] = useState<CatalogueRow | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (levelFilter === 'all' || row.level === levelFilter) &&
          (statusFilter === 'all' || row.status === statusFilter) &&
          (syncFilter === 'all' || row.syncState === syncFilter),
      ),
    [rows, levelFilter, statusFilter, syncFilter],
  );

  const paged = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const columns: Column<CatalogueRow>[] = [
    {
      id: 'name',
      header: 'Programme',
      value: (row) => row.name,
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--mx-weight-medium)' }}>{row.name}</div>
          <div style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
            {row.field} · v{row.version}
          </div>
        </div>
      ),
    },
    { id: 'level', header: 'Level', value: (row) => row.level },
    {
      id: 'status',
      header: 'Status',
      value: (row) => row.status,
      render: (row) => <Badge tone={STATUS_TONES[row.status]}>{row.status.replace('_', ' ')}</Badge>,
    },
    {
      id: 'sync',
      header: 'Freshness',
      value: (row) => row.syncState,
      render: (row) => (
        <div>
          <Badge tone={SYNC_TONES[row.syncState]}>{row.syncState.replace('_', ' ')}</Badge>
          {row.staleFields.length > 0 ? (
            <div style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-warning-text)', marginTop: 4 }}>
              {row.staleFields.join(', ')}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'tuition',
      header: 'Tuition',
      value: (row) => row.tuitionMinor ?? 0,
      render: (row) =>
        row.tuitionMinor === null || row.tuitionCurrency === null ? (
          <span style={{ color: 'var(--mx-ink-600)' }}>Not published</span>
        ) : (
          formatMoney(money(row.tuitionMinor, row.tuitionCurrency))
        ),
    },
    {
      id: 'deadline',
      header: 'Next deadline',
      value: (row) => row.nextDeadline ?? '',
      render: (row) => (row.nextDeadline === null ? '—' : formatDate(row.nextDeadline)),
    },
    {
      id: 'source',
      header: 'Source',
      value: (row) => row.sourceRef ?? '',
      defaultHidden: true,
    },
    {
      id: 'reviewer',
      header: 'Reviewed by',
      value: (row) => row.reviewedBy ?? '',
      defaultHidden: true,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
      <div
        style={{ display: 'flex', gap: 'var(--mx-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <FilterSelect
          label="Level"
          value={levelFilter}
          onChange={setLevelFilter}
          options={['all', ...new Set(rows.map((row) => row.level))]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={['all', 'draft', 'in_review', 'published', 'unpublished', 'archived']}
        />
        <FilterSelect
          label="Freshness"
          value={syncFilter}
          onChange={setSyncFilter}
          options={['all', 'synced', 'stale', 'pending_review', 'manual', 'failed']}
        />
      </div>

      <DataTable
        rows={paged}
        columns={columns}
        rowId={(row) => row.programKey}
        caption="Programme catalogue"
        searchPlaceholder="Search programmes"
        onRowClick={setDetail}
        bulkActions={[
          { id: 'publish', label: 'Publish', onRun: (selected) => onPublish?.(selected.map((r) => r.programKey)) },
          {
            id: 'unpublish',
            label: 'Unpublish',
            variant: 'destructive',
            onRun: (selected) => onUnpublish?.(selected.map((r) => r.programKey)),
          },
        ]}
        empty={
          <EmptyState
            title={rows.length === 0 ? 'No programmes yet' : 'Nothing matches these filters'}
            description={
              rows.length === 0
                ? 'This institution has not published any programmes. Import a catalogue file or add a programme by hand — both paths record who reviewed it.'
                : 'No programme matches the level, status and freshness filters you have set. Clearing the freshness filter usually widens it most.'
            }
          >
            {rows.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLevelFilter('all');
                  setStatusFilter('all');
                  setSyncFilter('all');
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </EmptyState>
        }
        footer={
          <Pagination
            rangeStart={filtered.length === 0 ? 0 : pageIndex * pageSize + 1}
            rangeEnd={Math.min((pageIndex + 1) * pageSize, filtered.length)}
            totalCount={filtered.length}
            pageSize={pageSize}
            hasPrevious={pageIndex > 0}
            hasNext={(pageIndex + 1) * pageSize < filtered.length}
            onPrevious={() => setPageIndex((index) => Math.max(0, index - 1))}
            onNext={() => setPageIndex((index) => index + 1)}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPageIndex(0);
            }}
          />
        }
      />

      {diff.length > 0 ? <SyncDiffTable rows={diff} /> : null}

      {detail !== null ? <RecordDrawer row={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const id = `mx-filter-${label.toLowerCase()}`;
  return (
    <div className="mx-field" style={{ minWidth: 160 }}>
      <label className="mx-field__label" htmlFor={id}>
        {label}
      </label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === 'all' ? 'All' : option.replace('_', ' ')}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The sync diff viewer.
 *
 * Expandable rows showing the per-field before and after, because a reviewer
 * approving a 400-row import needs to see what will change, not a count. Error
 * rows are rendered as errors, never folded into "3 rows skipped".
 */
function SyncDiffTable({ rows }: { rows: readonly SyncDiffRow[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (ref: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  return (
    <Card padding="lg">
      <CardHeader
        title="Import preview"
        description="Nothing has changed yet. Committing applies exactly this diff; rows with errors are skipped, not guessed at."
      />
      <div className="mx-table-wrap" style={{ marginTop: 'var(--mx-space-4)' }}>
        <table className="mx-table">
          <caption className="mx-visually-hidden">Import diff</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Change</th>
              <th scope="col">Fields</th>
              <th scope="col">
                <span className="mx-visually-hidden">Detail</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded.has(row.externalRef);
              return (
                <>
                  <tr key={row.externalRef}>
                    <td>{row.externalRef}</td>
                    <td>
                      <Badge
                        tone={
                          row.kind === 'error'
                            ? 'danger'
                            : row.kind === 'create'
                              ? 'success'
                              : row.kind === 'update'
                                ? 'info'
                                : 'neutral'
                        }
                      >
                        {row.kind}
                      </Badge>
                    </td>
                    <td>
                      {row.kind === 'error'
                        ? `${row.errors.length} problem${row.errors.length === 1 ? '' : 's'}`
                        : `${row.changes.length} field${row.changes.length === 1 ? '' : 's'}`}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={isOpen}
                        onClick={() => toggle(row.externalRef)}
                      >
                        {isOpen ? 'Hide' : 'Show'}
                      </Button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr key={`${row.externalRef}-detail`}>
                      <td colSpan={4} style={{ background: 'var(--mx-subtle)' }}>
                        {row.errors.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: 'var(--mx-space-4)', color: 'var(--mx-danger-text)' }}>
                            {row.errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        ) : (
                          <dl style={{ margin: 0 }}>
                            {row.changes.map((change) => (
                              <div
                                key={change.field}
                                style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr', gap: 'var(--mx-space-3)', padding: '4px 0' }}
                              >
                                <dt style={{ fontSize: 'var(--mx-text-sm)' }}>
                                  {change.field}
                                  {change.severity === 'blocking' ? (
                                    <>
                                      {' '}
                                      <Badge tone="warning">blocking</Badge>
                                    </>
                                  ) : null}
                                </dt>
                                <dd style={{ margin: 0, color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>
                                  {change.before ?? '(not set)'}
                                </dd>
                                <dd style={{ margin: 0, fontSize: 'var(--mx-text-sm)', fontWeight: 'var(--mx-weight-medium)' }}>
                                  → {change.after ?? '(cleared)'}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Side drawer for record detail, with the record's provenance in full. */
function RecordDrawer({ row, onClose }: { row: CatalogueRow; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${row.name} detail`}
      style={{
        position: 'fixed',
        inset: '0 0 0 auto',
        width: 'min(420px, 100vw)',
        background: 'var(--mx-surface)',
        borderLeft: '1px solid var(--mx-border)',
        boxShadow: 'var(--mx-shadow-3)',
        padding: 'var(--mx-space-6)',
        overflowY: 'auto',
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--mx-space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--mx-text-lg)' }}>{row.name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--mx-space-2)', marginTop: 'var(--mx-space-3)', flexWrap: 'wrap' }}>
        <Badge tone={STATUS_TONES[row.status]}>{row.status.replace('_', ' ')}</Badge>
        <Badge tone={SYNC_TONES[row.syncState]}>{row.syncState.replace('_', ' ')}</Badge>
        <Badge tone="neutral">version {row.version}</Badge>
      </div>

      <div style={{ marginTop: 'var(--mx-space-4)' }}>
        <ProvenanceStamp provenance={toProvenance(row)} staleFields={row.staleFields} />
      </div>

      <dl style={{ marginTop: 'var(--mx-space-4)' }}>
        <DetailRow label="Level" value={row.level} />
        <DetailRow label="Field" value={row.field} />
        <DetailRow
          label="Tuition"
          value={
            row.tuitionMinor === null || row.tuitionCurrency === null
              ? 'Not published'
              : formatMoney(money(row.tuitionMinor, row.tuitionCurrency))
          }
        />
        <DetailRow label="Next deadline" value={row.nextDeadline === null ? '—' : formatDate(row.nextDeadline)} />
        <DetailRow label="Source" value={row.sourceRef ?? 'Entered manually'} />
        <DetailRow label="Reviewed by" value={row.reviewedBy ?? 'Not recorded'} />
      </dl>

      <p style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-ink-600)' }}>
        Editing this programme creates a new effective-dated version. The current version stays
        readable, and any application already submitted against it is unaffected.
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--mx-space-3)', padding: '6px 0', borderBottom: '1px solid var(--mx-border)' }}>
      <dt style={{ color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 'var(--mx-text-sm)', textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
