import { h, svg } from '../ui.js';

/**
 * The admin dashboard shell — the collapsible-sidebar dashboard, in the DOM
 * builder this build renders through.
 *
 * The React version of this block lives in `@modex/ui`
 * (`blocks/collapsible-sidebar-dashboard.tsx`) and is what the Next.js consoles
 * use. This file is the same design against the same token names, because the
 * public build has no React and pulling one in to render a sidebar would double
 * the bundle for one component.
 *
 * What is *not* duplicated is any rule. Every count on the rail and every KPI
 * above the page comes from the console modules, which get them from the shared
 * predicates in `engine.js`. The shell decides layout; it decides nothing else.
 *
 * Three details carried over from the re-theme, each of which the vendor block
 * gets wrong for a product like this one:
 *
 * - **The collapsed rail keeps its labels for assistive technology.** Icons
 *   only is a visual affordance, not an information one.
 * - **A count is a number with a label**, not a coloured dot. A dot conveys
 *   "something happened" by colour and position alone.
 * - **The collapse state lives in `sessionStorage`, not `localStorage`.** A
 *   preference expressed on a shared workstation should not greet the next
 *   person who sits down at it.
 */

const COLLAPSE_KEY = 'modex-apply/admin-rail-collapsed';

function readCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(value) {
  try {
    sessionStorage.setItem(COLLAPSE_KEY, String(value));
  } catch {
    // A private window still gets a working toggle; it just does not survive a
    // route change. Not worth an error.
  }
}

/** The icon set, inline. Same reason as the design system's: no icon dependency. */
const ICONS = {
  home: ['m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'],
  chart: ['M3 3v18h18', 'M7 15v3M12 10v8M17 6v12'],
  building: ['M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16', 'M15 9h4a1 1 0 0 1 1 1v11', 'M2 21h20M8 8h3M8 12h3M8 16h3'],
  book: ['M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z', 'M9 3v14'],
  file: ['M14 3v5h5', 'M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
  activity: ['M3 12h4l3 8 4-16 3 8h4'],
  coins: ['M14.5 4.2a5 5 0 0 1 0 15.6M9 21a5 5 0 0 0 5-5'],
  chevrons: ['m6 17 5-5-5-5M13 17l5-5-5-5'],
};

export function icon(name) {
  const paths = ICONS[name] ?? ICONS.home;
  return svg('svg', {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false', class: 'dash-icon',
  }, name === 'coins' ? [svg('circle', { cx: 9, cy: 8, r: 5 }), ...paths.map((d) => svg('path', { d }))]
    : paths.map((d) => svg('path', { d })));
}

/**
 * Renders a console inside the dashboard chrome.
 *
 * `sections` is the rail: `{ id, label, href, icon, count, countLabel }`.
 * `stats` is the strip above the page: `{ id, label, value, detail, tone }`.
 * `body` is the console itself.
 */
export function adminShell({ active, sections, title, subtitle, stats = [], notice, body, activity }) {
  let collapsed = readCollapsed();

  const rail = h('nav', {
    class: 'dash-rail', 'aria-label': 'Admin sections', dataset: { collapsed: String(collapsed) },
  });

  const toggleIcon = icon('chevrons');
  const toggleLabel = h('span', { class: collapsed ? 'visually-hidden' : '' },
    collapsed ? 'Expand navigation' : 'Hide');

  const toggle = h('button', {
    type: 'button',
    class: 'dash-toggle',
    'aria-expanded': String(!collapsed),
    onClick: () => {
      collapsed = !collapsed;
      writeCollapsed(collapsed);
      rail.dataset.collapsed = String(collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggleIcon.dataset.rotated = String(!collapsed);
      toggleLabel.textContent = collapsed ? 'Expand navigation' : 'Hide';
      toggleLabel.className = collapsed ? 'visually-hidden' : '';
      for (const label of rail.querySelectorAll('.dash-label')) {
        label.className = collapsed ? 'dash-label visually-hidden' : 'dash-label';
      }
      for (const heading of rail.querySelectorAll('.dash-group-label')) {
        heading.hidden = collapsed;
      }
      const brand = rail.querySelector('.dash-brand-text');
      if (brand !== null) brand.hidden = collapsed;
    },
  }, toggleIcon, toggleLabel);

  toggleIcon.dataset.rotated = String(!collapsed);

  rail.append(
    h('div', { class: 'dash-brand' },
      h('div', { class: 'dash-brand-text', hidden: collapsed },
        h('strong', {}, 'Modex admin'),
        h('span', { class: 'dash-brand-detail' }, 'M. Haddad · demo session'))),
    h('div', { class: 'dash-groups' },
      groupsOf(sections).map(([groupLabel, items]) =>
        h('div', { class: 'dash-group' },
          h('div', { class: 'dash-group-label', hidden: collapsed }, groupLabel),
          h('ul', { class: 'dash-nav' },
            items.map((section) =>
              h('li', {},
                h('a', {
                  href: `#${section.href}`,
                  class: 'dash-link',
                  'aria-current': section.id === active ? 'page' : null,
                  title: section.label,
                },
                  h('span', { class: 'dash-icon-slot' }, icon(section.icon)),
                  h('span', { class: collapsed ? 'dash-label visually-hidden' : 'dash-label' }, section.label),
                  section.count > 0
                    ? h('span', { class: 'dash-count' },
                        h('span', { 'aria-hidden': 'true' }, String(section.count)),
                        h('span', { class: 'visually-hidden' },
                          `${section.count} ${section.countLabel ?? 'waiting'}`))
                    : null))))))),
    toggle);

  return h('div', { class: 'dash' },
    rail,
    h('div', { class: 'dash-main' },
      h('header', { class: 'dash-topbar' },
        h('div', { class: 'dash-titles' },
          h('strong', { class: 'dash-title' }, title),
          subtitle ? h('span', { class: 'dash-subtitle' }, subtitle) : null),
        h('div', { class: 'dash-actions' },
          h('span', { class: 'badge badge-neutral' }, 'Public build — nothing leaves this browser'))),
      h('div', { class: 'dash-content' },
        notice ?? null,
        stats.length > 0 ? statGrid(stats) : null,
        body,
        activity ?? null)));
}

/** `Workspace` first, then `Consoles`, in the order the sections were given. */
function groupsOf(sections) {
  const groups = new Map();
  for (const section of sections) {
    const key = section.group ?? 'Consoles';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section);
  }
  return [...groups.entries()];
}

/**
 * The KPI strip.
 *
 * The vendor block puts a green "+12% from last month" under every tile. Ours
 * takes a line that says *what the number counts*, because several of these
 * figures — quarantined files, reviews past their commitment — have no
 * direction that is good news, and a trend that is always green and always up
 * is decoration that looks like data.
 */
export function statGrid(stats) {
  return h('div', { class: 'dash-stats' },
    stats.map((stat) =>
      h('article', { class: 'card dash-stat', dataset: { tone: stat.tone ?? 'neutral' } },
        h('span', { class: 'dash-stat-label' }, stat.label),
        h('span', { class: 'dash-stat-value' }, stat.value),
        stat.detail ? h('span', { class: 'dash-stat-detail' }, stat.detail) : null)));
}

/** A horizontal bar, drawn from a share rather than a guessed width. */
export function bar(share, tone = 'action') {
  return h('div', { class: 'dash-bar', dataset: { tone } },
    h('div', {
      class: 'dash-bar-fill',
      style: `width:${Math.max(0, Math.min(1, share)) * 100}%`,
      'aria-hidden': 'true',
    }));
}
