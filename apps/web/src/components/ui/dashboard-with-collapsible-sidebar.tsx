'use client';

import type { ReactNode } from 'react';
import {
  ActivityIcon,
  BookIcon,
  BuildingIcon,
  ChartIcon,
  CoinsIcon,
  CollapsibleSidebarDashboard,
  DashboardActivity,
  DashboardStatGrid,
  FileIcon,
  HomeIcon,
  ShieldCheckIcon,
  type ActivityEntry,
  type DashboardNavGroup,
  type DashboardStat,
} from '@modex/ui';
import type { Console } from '@modex/contracts';
import type { ConsoleSession } from '@/lib/console';

/**
 * The admin dashboard shell, as the consoles use it.
 *
 * This is the integration point for the 21st.dev
 * `dashboard-with-collapsible-sidebar` block. The block itself lives in
 * `@modex/ui` (`blocks/collapsible-sidebar-dashboard.tsx`) with its vendor
 * palette rebound onto the Red Velvet tokens; what lives here is the part that
 * knows about *this* product: which sections exist, which of them the signed-in
 * actor may enter, and what the counters on the rail count.
 *
 * The split matters. A design-system block that imported `ConsoleSession` would
 * be a design system that cannot be used by anything but the console, and the
 * console's access rules would then be enforced in a package whose tests are
 * about colour contrast.
 *
 * **Nav is built from the session, never from a static list.** Rendering a
 * section somebody cannot enter teaches them to ignore refusals, and a rail
 * full of links that all 403 is worse than a short rail.
 */

interface SectionMeta {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Which console grants this section. `null` means every signed-in operator. */
  console: Console | null;
}

const SECTIONS: readonly SectionMeta[] = [
  { id: 'overview', label: 'Overview', href: '/admin', icon: <HomeIcon />, console: null },
  {
    id: 'insights',
    label: 'Insights',
    href: '/admin/insights',
    icon: <ChartIcon />,
    console: null,
  },
  {
    id: 'documents',
    label: 'Documents',
    href: '/admin/documents',
    icon: <FileIcon />,
    console: null,
  },
  {
    id: 'university',
    label: 'University',
    href: '/admin/university',
    icon: <BuildingIcon />,
    console: 'university',
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    href: '/admin/catalogue',
    icon: <BookIcon />,
    console: 'university',
  },
  { id: 'offers', label: 'Offers', href: '/admin/offers', icon: <CoinsIcon />, console: 'university' },
  { id: 'trust', label: 'Trust', href: '/admin/trust', icon: <ShieldCheckIcon />, console: 'trust' },
  {
    id: 'operations',
    label: 'Operations',
    href: '/admin/ops',
    icon: <ActivityIcon />,
    console: 'operations',
  },
  { id: 'finance', label: 'Finance', href: '/admin/finance', icon: <CoinsIcon />, console: 'finance' },
];

export interface AdminDashboardProps {
  session: ConsoleSession;
  /** The section id that is current. Matches `SECTIONS[].id`. */
  current: string;
  title: string;
  subtitle?: string;
  /** Counts keyed by section id, e.g. `{ documents: 7 }`. Zero renders nothing. */
  counts?: Readonly<Record<string, number>>;
  /** Rendered directly under the topbar, above everything else. */
  banner?: ReactNode;
  /** The KPI strip. Every admin page gets one; an empty array renders no strip. */
  stats?: readonly DashboardStat[];
  /** Recent activity, rendered under the page body. */
  activity?: readonly ActivityEntry[];
  children: ReactNode;
}

export function AdminDashboard({
  session,
  current,
  title,
  subtitle,
  counts = {},
  banner,
  stats = [],
  activity,
  children,
}: AdminDashboardProps) {
  const visible = SECTIONS.filter(
    (section) => section.console === null || session.consoles.includes(section.console),
  );

  const groups: DashboardNavGroup[] = [
    {
      id: 'workspace',
      label: 'Workspace',
      items: visible
        .filter((section) => section.console === null)
        .map((section) => ({
          id: section.id,
          label: section.label,
          href: section.href,
          icon: section.icon,
          current: section.id === current,
          count: counts[section.id],
          countLabel: section.id === 'documents' ? 'documents waiting' : 'waiting',
        })),
    },
    {
      id: 'consoles',
      label: 'Consoles',
      items: visible
        .filter((section) => section.console !== null)
        .map((section) => ({
          id: section.id,
          label: section.label,
          href: section.href,
          icon: section.icon,
          current: section.id === current,
          count: counts[section.id],
          countLabel: 'waiting',
        })),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <CollapsibleSidebarDashboard
      brand="Modex"
      brandDetail={session.organisationId === null ? 'Modex staff' : 'Your institution'}
      groups={groups}
      title={title}
      subtitle={subtitle ?? session.roles.join(' · ')}
      banner={banner}
    >
      {stats.length > 0 ? <DashboardStatGrid stats={stats} /> : null}
      {children}
      {activity ? (
        <section className="mx-card" style={{ padding: 'var(--mx-space-4)' }}>
          <h2 style={{ fontSize: 'var(--mx-text-md)', marginBottom: 'var(--mx-space-3)' }}>
            Recent activity
          </h2>
          <DashboardActivity entries={activity} />
        </section>
      ) : null}
    </CollapsibleSidebarDashboard>
  );
}
