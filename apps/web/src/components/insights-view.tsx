'use client';

import { Alert, Badge, Card, CardHeader } from '@modex/ui';
import {
  formatHours,
  formatRate,
  type FunnelRow,
  type InsightNote,
  type Rate,
  type Slice,
  type TrendPoint,
} from '@modex/contracts';
import { ConsoleShell } from './console-shell';
import type { ConsoleSession } from '@/lib/console';

/**
 * The insights console (Phase 8, #20).
 *
 * Every figure on this page arrives computed, from the shared functions in
 * `@modex/contracts/insights`. Nothing here divides one number by another: a
 * console that does its own arithmetic on the way to the screen is a console
 * that will eventually disagree with the API about what the platform did.
 *
 * The two rules the rendering has to hold up:
 *
 * **A withheld rate renders as withheld, with its reason** — never as zero, and
 * never as a bar of length nothing. `Rate.withheldReason` is printed unchanged.
 *
 * **A bar is drawn from a share, never from a pixel width someone guessed.**
 * The funnel bars use the cumulative share of the started cohort, so two stages
 * with equal counts are the same length, which is the only way the shape of the
 * chart carries information.
 */

export interface InsightsData {
  window: number;
  generatedAt: string;
  scope: string;
  funnel: FunnelRow[];
  reachedUniversity: Rate;
  trend: TrendPoint[];
  trendChange: number | null;
  byInstitution: Slice[];
  byCountry: Slice[];
  byProgramme: Slice[];
  timings: {
    medianAckHours: number | null;
    p90AckHours: number | null;
    medianReviewHours: number | null;
    p90ReviewHours: number | null;
  };
  documents: {
    total: number;
    decided: number;
    accepted: number;
    rejected: number;
    moreInformation: number;
    overdue: number;
    slaHours: number;
  };
  catalogue: { programmes: number; stale: number };
  network: { guides: number; active: number; restricted: number; suspended: number };
  register: { institutions: number; verified: number; unverified: number };
  offerValue: { currency: string; amountMinor: number; count: number }[];
  notes: InsightNote[];
}

export function InsightsView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: InsightsData;
}) {
  const started = data.funnel.find((row) => row.stage === 'started')?.count ?? 0;

  return (
    <ConsoleShell
      session={session}
      current={session.consoles[0] ?? 'operations'}
      title="Insights"
      stats={[
        {
          id: 'started',
          label: `Applications started (${data.window} days)`,
          value: String(started),
          detail:
            data.trendChange === null
              ? 'Too short a series to call a trend'
              : `${data.trendChange > 0 ? 'Up' : 'Down'} ${Math.abs(data.trendChange * 100).toFixed(0)}% on the first half of the window`,
        },
        {
          id: 'reached',
          label: 'Reached a university',
          value: formatRate(data.reachedUniversity),
          detail:
            data.reachedUniversity.withheldReason ??
            `${data.reachedUniversity.numerator} of ${data.reachedUniversity.denominator} confirmed received`,
          tone: 'info',
        },
        {
          id: 'ack',
          label: 'Median time to confirmation',
          value: formatHours(data.timings.medianAckHours),
          detail: `Slowest tenth: ${formatHours(data.timings.p90AckHours)}`,
        },
        {
          id: 'documents',
          label: 'Documents past the commitment',
          value: String(data.documents.overdue),
          detail: `Commitment is ${data.documents.slaHours} hours`,
          tone: data.documents.overdue > 0 ? 'warning' : 'success',
        },
      ]}
    >
      <section style={{ display: 'grid', gap: 'var(--mx-space-3)' }}>
        {data.notes.map((note) => (
          <Alert key={note.id} tone={note.tone === 'neutral' ? 'info' : note.tone} title={note.action ?? 'For information'}>
            {note.text}
          </Alert>
        ))}
      </section>

      <Card padding="lg">
        <CardHeader
          title="Where applications get to"
          description="Cumulative: an accepted application also counts as submitted. A payload we sent but no university has confirmed is not counted as having reached one."
        />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--mx-space-3)' }}>
          {data.funnel.map((row) => (
            <li key={row.stage}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--mx-text-sm)' }}>
                <span>{row.label}</span>
                <span>
                  {row.count}
                  {row.ofStarted.value === null ? null : ` · ${formatRate(row.ofStarted)}`}
                </span>
              </div>
              <div
                aria-hidden="true"
                style={{
                  height: 8,
                  borderRadius: 'var(--mx-radius-pill)',
                  background: 'var(--mx-subtle)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${started === 0 ? 0 : (row.count / started) * 100}%`,
                    height: '100%',
                    background: 'var(--mx-action)',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <div
        style={{
          display: 'grid',
          gap: 'var(--mx-space-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
        <SliceCard title="By institution" slices={data.byInstitution} />
        <SliceCard title="By country" slices={data.byCountry} />
        <SliceCard title="By programme" slices={data.byProgramme} />
      </div>

      <Card padding="lg">
        <CardHeader
          title="Document assessment"
          description="Counts of decisions taken in this window. No figure here is an admission likelihood."
        />
        <div style={{ display: 'flex', gap: 'var(--mx-space-2)', flexWrap: 'wrap' }}>
          <Badge tone="success">{data.documents.accepted} accepted</Badge>
          <Badge tone="warning">{data.documents.moreInformation} need more information</Badge>
          <Badge tone="danger">{data.documents.rejected} not accepted</Badge>
          <Badge tone="neutral">
            Median {formatHours(data.timings.medianReviewHours)} to a decision
          </Badge>
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="Published offer value"
          description="Per currency. There is deliberately no combined total — adding pounds to euros produces a number that means nothing."
        />
        {data.offerValue.length === 0 ? (
          <p className="mx-card__description">No published offers carry a cash value.</p>
        ) : (
          <ul style={{ fontSize: 'var(--mx-text-sm)' }}>
            {data.offerValue.map((total) => (
              <li key={total.currency}>
                {new Intl.NumberFormat('en-GB', {
                  style: 'currency',
                  currency: total.currency,
                  maximumFractionDigits: 0,
                }).format(total.amountMinor / 100)}{' '}
                across {total.count} offer(s)
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ConsoleShell>
  );
}

function SliceCard({ title, slices }: { title: string; slices: readonly Slice[] }) {
  return (
    <Card padding="lg">
      <CardHeader title={title} />
      {slices.length === 0 ? (
        <p className="mx-card__description">Nothing in this window.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 'var(--mx-text-sm)' }}>
          {slices.map((slice) => (
            <li key={slice.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--mx-space-3)' }}>
              <span>{slice.label}</span>
              <span>
                {slice.count} · {(slice.share * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
