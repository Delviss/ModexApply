import './styles.css';
import { h, svg, clear, link, button, append } from './ui.js';
import { load, store, subscribe, resetLocalState } from './store.js';
import { homeView } from './views/home.js';
import { catalogueView, compareView, programmeView, institutionView } from './views/catalogue.js';
import { applyView, applicationsView, applicationView } from './views/apply.js';
import { guidesView, guideView, messagesView, questionsView } from './views/guides.js';
import { savingsView } from './views/savings.js';
import { profileView } from './views/profile.js';
import { adminView } from './views/admin.js';

/**
 * Routes, matched on the hash so a deep link survives a static host with no
 * rewrite rules. Each entry returns a DOM node; nothing here builds markup from
 * a string.
 */
const ROUTES = [
  [[], homeView],
  [['programmes'], catalogueView],
  [['programmes', 'compare'], compareView],
  [['programmes', ':key'], (route) => programmeView(route.params.key)],
  [['institutions', ':id'], (route) => institutionView(route.params.id)],
  [['apply', ':key'], (route) => applyView(route.params.key, route.query)],
  [['applications'], applicationsView],
  [['applications', ':id'], (route) => applicationView(route.params.id)],
  [['guides'], guidesView],
  [['guides', ':id'], (route) => guideView(route.params.id)],
  [['messages'], (route) => messagesView(route.query)],
  [['questions'], questionsView],
  [['savings'], savingsView],
  [['profile'], profileView],
  [['admin'], (route) => adminView('overview', route.query)],
  [['admin', ':console'], (route) => adminView(route.params.console, route.query)],
];

/**
 * The header carries four destinations and nothing else.
 *
 * Everything that used to sit up here — the tagline, the public-build
 * disclosure, the consoles, the account pages and the project links — is in the
 * footer now. A header is for moving through the product; a footer is where the
 * explaining belongs, and it costs a reader nothing to scroll past.
 */
const NAV = [
  ['/programmes', 'Programmes'],
  ['/guides', 'Student guides'],
  ['/questions', 'Questions'],
  ['/applications', 'My applications'],
];

/** The rest of the site, grouped into the footer's four columns. */
const FOOTER_SECTIONS = [
  {
    title: 'Explore',
    links: [
      { label: 'Programmes', href: '/programmes' },
      { label: 'Compare programmes', href: '/programmes/compare' },
      { label: 'Student guides', href: '/guides' },
      { label: 'Questions', href: '/questions' },
      { label: 'Savings', href: '/savings' },
    ],
  },
  {
    title: 'Your account',
    links: [
      { label: 'My applications', href: '/applications' },
      { label: 'Messages', href: '/messages' },
      { label: 'Profile', href: '/profile' },
    ],
  },
  {
    title: 'Consoles',
    links: [
      { label: 'Admin overview', href: '/admin' },
      { label: 'Insights', href: '/admin/insights' },
      { label: 'Document assessment', href: '/admin/documents' },
      { label: 'Institution register', href: '/admin/university' },
      { label: 'Catalogue', href: '/admin/catalogue' },
      { label: 'Trust and safety', href: '/admin/trust' },
      { label: 'Operations', href: '/admin/ops' },
      { label: 'Finance', href: '/admin/finance' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'Source', href: 'https://github.com/Delviss/ModexApply', external: true },
      { label: 'Delivery board', href: 'board.html', external: true },
      {
        label: 'Architecture',
        href: 'https://github.com/Delviss/ModexApply/blob/main/docs/architecture.md',
        external: true,
      },
      {
        label: 'Guide safety',
        href: 'https://github.com/Delviss/ModexApply/blob/main/docs/guide-safety.md',
        external: true,
      },
      {
        label: 'Privacy',
        href: 'https://github.com/Delviss/ModexApply/blob/main/docs/privacy.md',
        external: true,
      },
    ],
  },
];


function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(search));

  for (const [pattern, view] of ROUTES) {
    if (pattern.length !== segments.length) continue;
    const params = {};
    const matched = pattern.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[index]);
        return true;
      }
      return part === segments[index];
    });
    if (matched) return { view, params, query, path: `/${segments.join('/')}` };
  }
  return { view: notFoundView, params: {}, query, path: `/${segments.join('/')}` };
}

function notFoundView() {
  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'That page does not exist'),
    h('p', { class: 'muted' }, 'The link may be from an older build of the site.'),
    h('p', {}, link('/programmes', 'Search programmes'), ' · ', link('/', 'Home')));
}

// --- Chrome -----------------------------------------------------------------

/** A stroked icon at the header's size. The name lives on the control. */
function icon(...children) {
  return svg('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, ...children);
}

/** A disc lit on one side: the same mark whichever theme is showing. */
const themeIcon = () => icon(
  svg('circle', { cx: '12', cy: '12', r: '8.2' }),
  svg('path', { d: 'M12 3.8a8.2 8.2 0 0 1 0 16.4z', fill: 'currentColor', stroke: 'none' }),
);

const menuIcon = () => icon(svg('path', { d: 'M3.75 7h16.5M3.75 12h16.5M3.75 17h16.5' }));
const closeIcon = () => icon(svg('path', { d: 'M6 6l12 12M18 6L6 18' }));

function chrome() {
  const drawer = h('div', { class: 'topbar__drawer', id: 'topbar-drawer', hidden: true },
    h('div', { class: 'wrap' },
      h('nav', { class: 'topbar__drawer-nav', 'data-nav': 'true', 'aria-label': 'All pages' },
        NAV.map(([href, label]) => link(href, label)),
        link('/savings', 'Savings'),
        link('/profile', 'Profile'),
        link('/admin', 'Admin'))));

  const menuButton = h('button', {
    type: 'button',
    class: 'icon-button topbar__menu',
    'aria-expanded': 'false',
    'aria-controls': 'topbar-drawer',
    'aria-label': 'Open the navigation menu',
    onClick: () => setDrawer(drawer.hidden),
  }, menuIcon(), closeIcon());

  /**
   * Opening the menu is a route change waiting to happen, so it closes on a
   * hash change as well as on the button — otherwise tapping a link leaves the
   * panel sitting over the page it just navigated to.
   */
  function setDrawer(open) {
    drawer.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close the navigation menu' : 'Open the navigation menu');
  }
  addEventListener('hashchange', () => setDrawer(false));

  return h('div', {},
    h('header', { class: 'topbar' },
      h('div', { class: 'wrap topbar__inner' },
        h('a', { class: 'brandmark', href: '#/' }, h('span', { class: 'dot' }, 'M'), 'Modex Apply'),
        h('nav', { class: 'primary', id: 'primary-nav', 'data-nav': 'true', 'aria-label': 'Primary' },
          NAV.map(([href, label]) => link(href, label))),
        h('div', { class: 'topbar__actions' },
          link('/profile', 'Profile', { class: 'topbar__account' }),
          h('button', {
            type: 'button',
            class: 'icon-button',
            'aria-label': 'Switch between the light and dark theme',
            title: 'Switch theme',
            onClick: toggleTheme,
          }, themeIcon()),
          menuButton)),
      drawer),
    h('main', { id: 'main', tabindex: '-1' }),
    footer());
}

/**
 * Two cards, after `@aliimam/footer-section-4`.
 *
 * The crimson card states who this is and what the build is; the surface card
 * holds every destination the header no longer carries. The block ships with a
 * newsletter sign-up in the second card's base, which this build cannot
 * honestly offer — nothing entered here leaves the device — so that slot holds
 * the standing disclaimer and the one control that acts on local data instead.
 */
function footer() {
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'wrap site-footer__grid' },
      h('div', { class: 'site-footer__brand' },
        h('a', { class: 'brandmark brandmark--onband', href: '#/' },
          h('span', { class: 'dot' }, 'M'), 'Modex Apply'),
        h('div', { class: 'site-footer__brand-base' },
          h('p', { class: 'site-footer__tagline' }, 'Apply direct. Ask students. Save more.'),
          h('p', { class: 'site-footer__note' },
            h('strong', {}, 'Public build. '),
            'The platform runs entirely in your browser — nothing you enter here leaves this device. ',
            'The catalogue is sample data; the ',
            link('/admin/university', 'institution register'),
            ' holds real universities with publicly verifiable identity facts only.'),
          h('p', { class: 'site-footer__copyright' },
            `© ${new Date().getFullYear()} Modex Apply. All rights reserved.`))),

      h('div', { class: 'site-footer__links' },
        h('div', { class: 'site-footer__columns' },
          FOOTER_SECTIONS.map((section) =>
            h('div', { class: 'site-footer__column' },
              h('h2', { class: 'site-footer__heading' }, section.title),
              h('ul', { class: 'site-footer__list' },
                section.links.map((entry) =>
                  h('li', {}, entry.external
                    ? h('a', { href: entry.href }, entry.label)
                    : link(entry.href, entry.label))))))),
        h('div', { class: 'site-footer__base' },
          h('p', { class: 'site-footer__legal' },
            'Modex Apply is not an education agent, an immigration adviser or an admissions decision maker. ',
            'Universities decide admission; governments decide visas. Guides are current students, never staff, ',
            'and never collect tuition or application fees.'),
          button('Reset this browser’s data', () => {
            resetLocalState();
            location.hash = '#/';
          }, 'secondary', { class: 'btn btn-secondary btn-sm' })))));
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem('modex-apply/theme', root.dataset.theme);
  } catch {
    /* the theme simply does not persist */
  }
}

function applyStoredTheme() {
  try {
    const stored = localStorage.getItem('modex-apply/theme');
    if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  } catch {
    /* system preference then */
  }
}

let current = null;
let rendering = false;
let renderQueued = false;

/**
 * One paint at a time.
 *
 * A view that creates something on the way in — the wizard's draft, a new
 * conversation — mutates the store while the renderer is still running. Without
 * this guard the notification re-enters `render`, the second pass appends into
 * the same container, and the page quietly shows every control twice.
 */
function render() {
  if (rendering) { renderQueued = true; return; }
  rendering = true;
  try {
    paint();
  } finally {
    rendering = false;
  }
  if (renderQueued) { renderQueued = false; render(); }
}

function paint() {
  const route = parseRoute();
  const main = document.getElementById('main');
  if (main === null) return;

  /**
   * Where the keyboard was.
   *
   * A tick on one checkbox re-renders the whole view, which replaces the
   * control that was just operated — so without this, a keyboard user ticking
   * three documents in a row is thrown back to the top of the page after each
   * one. Controls that live inside a list a change rebuilds carry a stable
   * `data-focus-key`, and focus is put back on the same key afterwards.
   */
  const focusKey = document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.focusKey ?? null
    : null;

  for (const anchor of document.querySelectorAll('[data-nav] a')) {
    const href = anchor.getAttribute('href').slice(1);
    const active = href === '/' ? route.path === '/' : route.path.startsWith(href);
    if (active) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }

  clear(main);
  try {
    append(main, [route.view(route)]);
  } catch (error) {
    console.error(error);
    append(main, [
      h('div', { class: 'wrap stack' },
        h('h1', {}, 'Something went wrong on this page'),
        h('p', { class: 'muted' }, String(error && error.message ? error.message : error)),
        h('p', {}, link('/', 'Back to the home page'))),
    ]);
  }

  // Route changes move focus to the heading the way a page load would, so a
  // screen-reader user is not left at the top of an unchanged nav. Within one
  // page, focus goes back to the control that caused the re-render.
  if (current !== null && current !== route.path) main.focus({ preventScroll: true });
  else if (focusKey !== null) {
    const restored = main.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (restored !== null) restored.focus({ preventScroll: true });
  }
  if (current !== route.path) scrollTo({ top: 0, behavior: 'instant' });
  current = route.path;
}

async function boot() {
  applyStoredTheme();
  const app = document.getElementById('app');
  clear(app);
  app.append(chrome());
  document.getElementById('main').append(
    h('div', { class: 'wrap muted' }, 'Loading the platform…'),
  );

  try {
    await load();
  } catch (error) {
    clear(document.getElementById('main')).append(
      h('div', { class: 'wrap stack' },
        h('h1', {}, 'The platform data did not load'),
        h('p', { class: 'muted' }, String(error.message)),
        h('p', { class: 'small muted' },
          'If you are opening this file directly from disk, browsers block the data request. ',
          'Serve the folder over HTTP instead — `pnpm site:serve` does it.')),
    );
    return;
  }

  subscribe(render);
  addEventListener('hashchange', render);
  render();
}

boot();
