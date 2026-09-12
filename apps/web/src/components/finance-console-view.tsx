'use client';

import { Alert, Badge, Card, CardHeader, DataTable, EmptyState, StatCard } from '@modex/ui';
import { checkDualApproval, formatMoney, money } from '@modex/contracts';
import { ConsoleShell } from './console-shell';
import { ConsoleAction } from './console-chrome';
import type { ConsoleSession } from '@/lib/console';

interface RewardRow {
  id: string;
  guideId: string;
  kind: string;
  state: string;
  amountMinor: number | null;
  currency: string | null;
  earnedAt: string | null;
  sessionStatus: string | null;
  needsDualApproval: boolean;
  payout: { id: string; state: string; initiatedBy: string } | null;
}

interface PayoutRow {
  id: string;
  guideId: string;
  amountMinor: number;
  currency: string;
  state: 'pending_approval' | 'approved' | 'rejected' | 'paid';
  initiatedBy: string;
  initiatedAt: string;
  approvedBy: string | null;
  paidAt: string | null;
}

interface Settlement {
  window: { from: string; to: string };
  currencies: { currency: string; byKind: Record<string, number>; netMinor: number }[];
  transactionCount: number;
}

export interface FinanceConsoleData {
  rewards: RewardRow[];
  payouts: PayoutRow[];
  settlement: Settlement;
}

/**
 * The finance console's view (Phase 6 §4).
 *
 * `checkDualApproval` runs here as well as on the server, and that duplication
 * is the point: the server refuses, and this renders *why* on the disabled
 * button. Hiding the control instead would leave an operator wondering whether
 * the page was broken.
 */
export function FinanceConsoleView({
  session,
  data,
}: {
  session: ConsoleSession;
  data: FinanceConsoleData;
}) {
  const pending = data.payouts.filter((row) => row.state === 'pending_approval');

  return (
    <ConsoleShell session={session} current="finance" title="Finance console">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-6)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--mx-space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          }}
        >
          <StatCard label="Rewards awaiting payout" value={data.rewards.length} />
          <StatCard label="Payouts awaiting approval" value={pending.length} />
          <StatCard label="Transactions, 30 days" value={data.settlement.transactionCount} />
          <StatCard label="Currencies settled" value={data.settlement.currencies.length} />
        </section>

        <Alert tone="info" title="Tuition is not collected here">
          Modex handles its own service payments and guide rewards only. A tuition payment appears,
          if at all, as a reference the student recorded — there is no column on these tables it
          could be written into.
        </Alert>

        <Card padding="lg">
          <CardHeader
            title="Payouts awaiting approval"
            description="A high-value payout cannot be approved by whoever started it. The rule is enforced server-side; the disabled button is so you are told why."
          />
          <DataTable
            className="mx-console-table"
            rows={pending}
            rowId={(row) => row.id}
            caption="Payouts awaiting approval"
            columns={[
              { id: 'guide', header: 'Guide', value: (row) => row.guideId },
              {
                id: 'amount',
                header: 'Amount',
                value: (row) => row.amountMinor,
                sortable: true,
                render: (row) => formatMoney(money(row.amountMinor, row.currency)),
              },
              { id: 'initiated', header: 'Started by', value: (row) => row.initiatedBy },
              {
                id: 'approve',
                header: 'Approve',
                value: (row) => row.id,
                render: (row) => {
                  const check = checkDualApproval({
                    amountMinor: row.amountMinor,
                    currency: row.currency,
                    initiatedBy: row.initiatedBy,
                    approverId: session.userId,
                  });
                  return (
                    <ConsoleAction
                      path={`/admin/finance/payouts/${row.id}/approve`}
                      body={{}}
                      label="Approve"
                      variant="primary"
                      disabledReason={check.ok ? null : check.reason}
                    />
                  );
                },
              },
              {
                id: 'reject',
                header: 'Reject',
                value: (row) => row.id,
                render: (row) => (
                  <ConsoleAction
                    path={`/admin/finance/payouts/${row.id}/reject`}
                    label="Reject"
                    variant="destructive"
                    confirm={{
                      title: 'Reject this payout',
                      consequences: (
                        <>
                          The reward stays earned and unpaid. The guide is not told a reason
                          automatically — say something they could act on.
                        </>
                      ),
                      phrase: 'reject',
                      submitLabel: 'Reject payout',
                    }}
                  />
                ),
              },
            ]}
            empty={
              <EmptyState
                title="Nothing awaiting approval"
                description="Payouts appear here once somebody starts one from the rewards queue."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Rewards earned"
            description="A reward depends on the session being delivered, and on nothing else. There is no column here that joins a payout to an admission outcome."
          />
          <DataTable
            className="mx-console-table"
            rows={data.rewards}
            rowId={(row) => row.id}
            caption="Guide rewards awaiting payout"
            columns={[
              { id: 'guide', header: 'Guide', value: (row) => row.guideId },
              { id: 'kind', header: 'Kind', value: (row) => row.kind, sortable: true },
              {
                id: 'amount',
                header: 'Amount',
                value: (row) => row.amountMinor ?? -1,
                sortable: true,
                render: (row) =>
                  row.amountMinor === null || row.currency === null ? (
                    <span style={{ color: 'var(--mx-text-muted)' }}>No cash value</span>
                  ) : (
                    formatMoney(money(row.amountMinor, row.currency))
                  ),
              },
              {
                id: 'session',
                header: 'Session',
                value: (row) => row.sessionStatus ?? '',
                render: (row) =>
                  row.sessionStatus === 'completed' ? (
                    <Badge tone="success">completed</Badge>
                  ) : (
                    <Badge tone="warning">{row.sessionStatus ?? 'no session'}</Badge>
                  ),
              },
              {
                id: 'dual',
                header: 'Approval',
                value: (row) => String(row.needsDualApproval),
                render: (row) =>
                  row.needsDualApproval ? <Badge tone="warning">Needs two actors</Badge> : 'Single',
              },
              {
                id: 'start',
                header: 'Payout',
                value: (row) => row.payout?.state ?? '',
                render: (row) =>
                  row.payout === null ? (
                    <ConsoleAction
                      path="/admin/finance/payouts"
                      body={{ rewardEntryId: row.id }}
                      label="Start payout"
                      disabledReason={
                        row.sessionStatus !== null && row.sessionStatus !== 'completed'
                          ? 'The session behind this reward is not completed.'
                          : null
                      }
                    />
                  ) : (
                    <Badge tone="neutral">{row.payout.state.replace(/_/g, ' ')}</Badge>
                  ),
              },
            ]}
            empty={
              <EmptyState
                title="No rewards waiting"
                description="A reward is earned when a session is delivered, not when a student is admitted."
              />
            }
          />
        </Card>

        <Card padding="lg">
          <CardHeader
            title="Settlement"
            description="Per currency, never converted. A single total would apply an exchange rate nobody in this system chose."
          />
          <DataTable
            className="mx-console-table"
            rows={data.settlement.currencies}
            rowId={(row) => row.currency}
            caption="Settlement by currency"
            columns={[
              { id: 'currency', header: 'Currency', value: (row) => row.currency },
              {
                id: 'payments',
                header: 'Service payments',
                value: (row) => row.byKind.service_payment ?? 0,
                render: (row) =>
                  formatMoney(money(row.byKind.service_payment ?? 0, row.currency)),
              },
              {
                id: 'refunds',
                header: 'Refunds',
                value: (row) => row.byKind.service_refund ?? 0,
                render: (row) => formatMoney(money(row.byKind.service_refund ?? 0, row.currency)),
              },
              {
                id: 'payouts',
                header: 'Guide payouts',
                value: (row) => row.byKind.guide_payout ?? 0,
                render: (row) => formatMoney(money(row.byKind.guide_payout ?? 0, row.currency)),
              },
              {
                id: 'net',
                header: 'Net',
                value: (row) => row.netMinor,
                render: (row) => formatMoney(money(row.netMinor, row.currency)),
              },
            ]}
            empty={
              <EmptyState
                title="Nothing settled in this window"
                description="Service payments, refunds and payouts appear here as they settle."
              />
            }
          />
        </Card>
      </div>
    </ConsoleShell>
  );
}
