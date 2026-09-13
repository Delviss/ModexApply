'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Badge } from '../primitives/badge.js';
import { BellIcon, ChevronsRightIcon, MoonIcon, SunIcon } from '../primitives/icons.js';

/**
 * Collapsible-sidebar dashboard — re-themed from the 21st.dev
 * `dashboard-with-collapsible-sidebar` block.
 *
 * The vendor source arrives as Tailwind utility classes over the stock grey,
 * blue and green ramps — surfaces, the selected nav item, the notification
 * count and every KPI caption. None of that survives the crossing, and not only
 * because the vendor-colour gate refuses it. Three of the rebindings are
 * decisions rather than swaps:
 *
 * **The active nav item is brand crimson; nothing else in the chrome is.** The
 * vendor marks the selection with the same blue it uses for a notification
 * count and a KPI icon, which leaves a reader with no way to tell "you are
 * here" from "look at this". Crimson means action and identity in Red Velvet,
 * and it is spent once.
 *
 * **The theme toggle writes `data-theme`, not a class on `<html>`.** The vendor
 * adds and removes `.dark`, which makes the page theme a property of whichever
 * component rendered last. Red Velvet themes on `data-theme` with a
 * `prefers-color-scheme` default, so the toggle here sets that attribute and
 * remembers the choice — and defaults to *following the system* rather than to
 * light, because a console people open at 3am should not flash white.
 *
 * **A notification count is a number with a label, never a bare dot.** The
 * vendor's red dot conveys "something happened" by colour and position alone.
 * Here every count carries text for a screen reader, which is Phase 0 §1.5
 * applied to the chrome rather than only to verification state.
 *
 * The collapse state is deliberately *not* persisted to `localStorage`. An
 * operator who collapses the rail on a shared workstation has expressed a
 * preference for that session; restoring it for the next person is a small,
 * confusing surprise in a surface where every other element says who you are.
 */

export interface DashboardNavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  current?: boolean;
  /** A count worth interrupting for. Rendered with its own accessible text. */
  count?: number;
  /** What the count means, e.g. "documents waiting". Required when `count` is set. */
  countLabel?: string;
}

export interface DashboardNavGroup {
  id: string;
  label?: string;
  items: readonly DashboardNavItem[];
}

export interface CollapsibleSidebarDashboardProps {
  /** The brand mark and workspace name. Hidden when the rail is collapsed. */
  brand: ReactNode;
  /** One line under the brand — the plan, the organisation, the role. */
  brandDetail?: ReactNode;
  groups: readonly DashboardNavGroup[];
  /** The page title in the topbar. One per page; the `<h1>` stays in the body. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Unread count for the topbar bell. Zero renders no indicator at all. */
  notifications?: { count: number; label: string; href?: string };
  /** Extra topbar controls, placed before the theme toggle. */
  actions?: ReactNode;
  /** Rendered above the dashboard body — a step-up prompt, an impersonation banner. */
  banner?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSidebarDashboard({
  brand,
  brandDetail,
  groups,
  title,
  subtitle,
  notifications,
  actions,
  banner,
  children,
  className,
}: CollapsibleSidebarDashboardProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={cn('mx-dash', className)}>
      <nav
        className="mx-dash__rail"
        data-collapsed={collapsed}
        aria-label="Console sections"
      >
        <div className="mx-dash__brand">
          {collapsed ? null : (
            <div className="mx-dash__brand-text">
              <strong>{brand}</strong>
              {brandDetail ? <span className="mx-dash__brand-detail">{brandDetail}</span> : null}
            </div>
          )}
        </div>

        <div className="mx-dash__groups">
          {groups.map((group) => (
            <div key={group.id} className="mx-dash__group">
              {group.label && !collapsed ? (
                <div className="mx-nav__group-label">{group.label}</div>
              ) : null}
              <ul className="mx-nav">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      className="mx-nav__link mx-dash__link"
                      href={item.href}
                      aria-current={item.current ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="mx-dash__icon" aria-hidden={item.icon ? 'true' : undefined}>
                        {item.icon}
                      </span>
                      {collapsed ? (
                        <span className="mx-visually-hidden">{item.label}</span>
                      ) : (
                        <span className="mx-dash__label">{item.label}</span>
                      )}
                      {item.count !== undefined && item.count > 0 ? (
                        <span className="mx-dash__count">
                          <span aria-hidden="true">{item.count}</span>
                          <span className="mx-visually-hidden">
                            {`${item.count} ${item.countLabel ?? 'waiting'}`}
                          </span>
                        </span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="mx-dash__toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronsRightIcon
            className={cn('mx-dash__toggle-icon')}
            data-rotated={!collapsed}
          />
          <span className={collapsed ? 'mx-visually-hidden' : undefined}>
            {collapsed ? 'Expand navigation' : 'Hide'}
          </span>
        </button>
      </nav>

      <div className="mx-dash__main">
        <header className="mx-dash__topbar">
          <div className="mx-dash__titles">
            <strong className="mx-dash__title">{title}</strong>
            {subtitle ? <span className="mx-dash__subtitle">{subtitle}</span> : null}
          </div>
          <div className="mx-dash__actions">
            {actions}
            {notifications && notifications.count > 0 ? (
              <a className="mx-dash__bell" href={notifications.href ?? '#'}>
                <BellIcon />
                <Badge tone="danger">{notifications.count}</Badge>
                <span className="mx-visually-hidden">
                  {`${notifications.count} ${notifications.label}`}
                </span>
              </a>
            ) : null}
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-dash__content">
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Light / dark / follow-the-system, in that cycle.
 *
 * A two-state toggle cannot express "follow the system", so the first click
 * from the default lands on the opposite of what the system is showing and the
 * third returns control to the OS. The button always names the state it will
 * move *to*, because a control labelled with its current state is the single
 * most common toggle bug.
 */
type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'modex:theme';

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // Storage blocked in a private window. The toggle still works for this
      // page; it just does not survive a reload, which is not worth an error.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* see above */
    }
  }, [theme]);

  const next = useCallback(
    () => setTheme((value) => (value === 'system' ? 'dark' : value === 'dark' ? 'light' : 'system')),
    [],
  );

  const nextLabel =
    theme === 'system' ? 'Switch to dark' : theme === 'dark' ? 'Switch to light' : 'Follow system theme';

  return (
    <button type="button" className="mx-dash__theme" onClick={next} title={nextLabel}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span className="mx-visually-hidden">{nextLabel}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The dashboard body
// ---------------------------------------------------------------------------

export interface DashboardStat {
  id: string;
  label: string;
  value: string;
  /** The one line under the number. What it counts — never how good it is. */
  detail?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

/**
 * The KPI strip.
 *
 * The vendor block puts a green "+12% from last month" under every tile,
 * hard-coded. Ours takes a `detail` that says what the number counts, because a
 * trend line that is always green and always up is decoration that looks like
 * data — and because several of these figures (quarantined files, overdue
 * reviews) have no direction that is good news.
 */
export function DashboardStatGrid({ stats }: { stats: readonly DashboardStat[] }) {
  return (
    <div className="mx-dash__stats">
      {stats.map((stat) => (
        <article key={stat.id} className="mx-card mx-dash__stat" data-tone={stat.tone ?? 'neutral'}>
          <div className="mx-dash__stat-head">
            <span className="mx-dash__stat-label">{stat.label}</span>
            {stat.icon ? (
              <span className="mx-dash__stat-icon" aria-hidden="true">
                {stat.icon}
              </span>
            ) : null}
          </div>
          <span className="mx-dash__stat-value">{stat.value}</span>
          {stat.detail ? <span className="mx-dash__stat-detail">{stat.detail}</span> : null}
        </article>
      ))}
    </div>
  );
}

export interface ActivityEntry {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  href?: string;
}

/** The recent-activity list, with the time as a real `<time>` element. */
export function DashboardActivity({
  entries,
  emptyMessage = 'Nothing has happened yet.',
}: {
  entries: readonly ActivityEntry[];
  emptyMessage?: string;
}) {
  if (entries.length === 0) {
    return <p className="mx-dash__empty">{emptyMessage}</p>;
  }
  return (
    <ul className="mx-dash__activity">
      {entries.map((entry) => (
        <li key={entry.id} className="mx-dash__activity-row" data-tone={entry.tone ?? 'neutral'}>
          <div className="mx-dash__activity-body">
            <span className="mx-dash__activity-title">
              {entry.href ? <a href={entry.href}>{entry.title}</a> : entry.title}
            </span>
            <span className="mx-dash__activity-detail">{entry.detail}</span>
          </div>
          <time className="mx-dash__activity-time" dateTime={entry.at}>
            {new Date(entry.at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </li>
      ))}
    </ul>
  );
}
