import type { ReactNode } from 'react';
import { AppShell, Badge } from '@modex/ui';
import type { Console } from '@modex/contracts';
import type { ConsoleSession } from '@/lib/console';

/**
 * One shell, four workspaces (Phase 6 design spec).
 *
 * Each console gets a distinct identity **without a distinct palette**: the
 * sidebar header names the console, the top bar carries the workspace label,
 * and all four use the same Red Velvet tokens. Four colour schemes would mean
 * four sets of state colours, and "verified" would stop meaning one thing.
 *
 * The nav is built from the consoles the session actually holds. Rendering a
 * console somebody cannot enter teaches them to ignore refusals.
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
  children: ReactNode;
}

export function ConsoleShell({
  session,
  current,
  sections = [],
  title,
  banner,
  children,
}: ConsoleShellProps) {
  const meta = CONSOLE_META[current];

  return (
    <AppShell
      brand={
        <div>
          <strong style={{ color: 'var(--mx-action)' }}>Modex</strong>{' '}
          <span style={{ color: 'var(--mx-text-muted)' }}>{meta.label}</span>
        </div>
      }
      organisation={
        <div className="mx-card" style={{ padding: 'var(--mx-space-3)' }}>
          <div style={{ fontSize: 'var(--mx-text-sm)', fontWeight: 'var(--mx-weight-medium)' }}>
            {session.organisationId === null ? 'Modex staff' : 'Your institution'}
          </div>
          <Badge tone={session.stepUp.fresh ? 'success' : 'warning'}>
            {session.stepUp.fresh ? 'Confirmed' : 'Confirmation needed'}
          </Badge>
        </div>
      }
      groups={[
        ...(sections.length === 0
          ? []
          : [{ id: 'sections', label: meta.label, items: sections }]),
        {
          id: 'consoles',
          label: 'Consoles',
          items: session.consoles.map((name) => ({
            id: name,
            label: CONSOLE_META[name].label,
            href: CONSOLE_META[name].href,
            current: name === current,
          })),
        },
      ]}
      topbar={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--mx-space-3)',
            width: '100%',
          }}
        >
          <strong>{title}</strong>
          <span style={{ fontSize: 'var(--mx-text-xs)', color: 'var(--mx-text-muted)' }}>
            {session.roles.join(' · ')}
          </span>
        </div>
      }
    >
      {banner}
      {children}
    </AppShell>
  );
}
