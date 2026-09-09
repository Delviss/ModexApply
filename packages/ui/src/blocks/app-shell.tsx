'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * App shell — re-themed from `@arunjdass/dashboard-sidebar`, with the
 * org-switcher pattern from `@ruixen.ui/sidebar-showcase`.
 *
 * The primary shell for the student, university, trust and ops portals. Brand
 * crimson appears in exactly two places in the chrome: the brand mark and the
 * active nav item.
 */

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  current?: boolean;
}

export interface NavGroup {
  id: string;
  label?: string;
  items: readonly NavItem[];
}

export interface AppShellProps {
  brand: ReactNode;
  groups: readonly NavGroup[];
  /** Organisation switcher — the university portal's tenant boundary, made visible. */
  organisation?: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AppShell({
  brand,
  groups,
  organisation,
  topbar,
  children,
  className,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={cn('mx-shell', className)}>
      <aside className="mx-shell__sidebar" data-collapsed={collapsed}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {collapsed ? null : brand}
          <button
            type="button"
            className="mx-button"
            data-variant="ghost"
            data-size="sm"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '»' : '«'}
            <span className="mx-visually-hidden">
              {collapsed ? 'Expand navigation' : 'Collapse navigation'}
            </span>
          </button>
        </div>

        {organisation && !collapsed ? organisation : null}

        <nav aria-label="Main">
          {groups.map((group) => (
            <div key={group.id}>
              {group.label && !collapsed ? (
                <div className="mx-nav__group-label">{group.label}</div>
              ) : null}
              <ul className="mx-nav">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      className="mx-nav__link"
                      href={item.href}
                      aria-current={item.current ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      {item.icon}
                      {collapsed ? <span className="mx-visually-hidden">{item.label}</span> : item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="mx-shell__main">
        {topbar ? <header className="mx-shell__topbar">{topbar}</header> : null}
        <main className="mx-shell__content">{children}</main>
      </div>
    </div>
  );
}