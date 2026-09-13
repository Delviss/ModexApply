import type { ReactNode } from 'react';
import type { Console } from '@modex/contracts';
import type { DashboardStat } from '@modex/ui';
import type { ConsoleSession } from '@/lib/console';
import { AdminDashboard } from '@/components/ui/dashboard-with-collapsible-sidebar';

/**
 * One shell, every workspace (Phase 6 design spec, extended in Phase 8).
 *
 * Each console gets a distinct identity **without a distinct palette**: the
 * sidebar header names the workspace, the top bar carries the page title, and
 * all of them use the same Red Velvet tokens. Several colour schemes would mean
 * several sets of state colours, and "verified" would stop meaning one thing.
 *
 * Phase 8 moved the chrome from `AppShell` to the collapsible-sidebar dashboard
 * block, so every console page now carries the same rail, the same KPI strip
 * and the same activity list rather than each console inventing its own header.
 * `ConsoleShell` stayed as the seam: pages pass what they know (a title, their
 * stats, their sub-navigation) and the section list, the access filter and the
 * counters live in one place behind it.
 */
const CONSOLE_META: Readonly<Record<Console, { label: string; href: string; blurb: string }>> = {
  university: {
    label: 'University',
    href: '/admin/university',
    blurb: 'Your institution’s applications, catalogue, offers and guides.',
  },
  trust: {
    label: 'Trust',
    href: '/admin/trust',
    blurb: 'Verification, cases, risk signals and sanctions.',
  },
  operations: {
    label: 'Operations',
    href: '/admin/ops',
    blurb: 'Catalogue sync, connector health, exceptions and notifications.',
  },
  finance: {
    label: 'Finance',
    href: '/admin/finance',
    blurb: 'Modex transactions, guide payouts, refunds and settlement.',
  },
};

export function consoleMeta(console: Console) {
  return CONSOLE_META[console];
}

export interface ConsoleShellProps {
  session: ConsoleSession;
  current: Console;
  /** Sub-navigation inside this console. */
  sections?: readonly { id: string; label: string; href: string; current?: boolean }[];
  title: string;
  banner?: ReactNode;
  /** The KPI strip above the page body. */
  stats?: readonly DashboardStat[];
  /** Counters on the rail, keyed by section id. */
  counts?: Readonly<Record<string, number>>;
  children: ReactNode;
}

export function ConsoleShell({
  session,
  current,
  sections = [],
  title,
  banner,
  stats,
  counts,
  children,
}: ConsoleShellProps) {
  const meta = CONSOLE_META[current];

  return (
    <AdminDashboard
      session={session}
      current={current}
      title={title}
      subtitle={`${meta.label} · ${session.roles.join(' · ')}`}
      banner={banner}
      stats={stats}
      counts={counts}
    >
      {sections.length > 0 ? (
        <nav aria-label={`${meta.label} sections`} className="mx-chips">
          {sections.map((section) => (
            <a
              key={section.id}
              href={section.href}
              className="mx-chip"
              aria-current={section.current ? 'page' : undefined}
            >
              {section.label}
            </a>
          ))}
        </nav>
      ) : null}
      {children}
    </AdminDashboard>
  );
}
