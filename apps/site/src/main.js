import './styles.css';
import { h, clear, link, button, append } from './ui.js';
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

const NAV = [
  ['/programmes', 'Programmes'],
  ['/guides', 'Student guides'],
  ['/questions', 'Questions'],
  ['/savings', 'Savings'],
  ['/applications', 'My applications'],
  ['/profile', 'Profile'],
  ['/admin', 'Admin'],
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

function chrome() {
  const themeButton = button('Theme', toggleTheme, 'ghost', {
    'aria-label': 'Switch between the light and dark theme',
    title: 'Switch theme',
  });

  return h('div', {},
    h('div', { class: 'demo-strip' },
      h('div', { class: 'wrap' },
        h('strong', {}, 'Public build. '),
        'The platform runs entirely in your browser — nothing you enter here leaves this device. ',
        'The catalogue is sample data; the ',
        link('/admin/university', 'institution register'),
        ' holds real universities with publicly verifiable identity facts only.')),
    h('header', { class: 'topbar' },
      h('div', { class: 'wrap' },
        h('a', { class: 'brandmark', href: '#/' }, h('span', { class: 'dot' }, 'M'), 'Modex Apply'),
        h('span', { class: 'small muted hide-sm' }, 'Apply direct. Ask students. Save more.'),
        h('nav', { class: 'primary', id: 'primary-nav', 'aria-label': 'Primary' },
          NAV.map(([href, label]) => link(href, label))),
        themeButton)),
    h('main', { id: 'main', tabindex: '-1' }),
    footer());
}

function footer() {
  return h('footer', { class: 'site' },
    h('div', { class: 'wrap stack-sm' },
      h('div', { class: 'row' },
        h('strong', {}, 'Modex Apply'),
        h('span', {}, '·'),
        h('a', { href: 'https://github.com/Delviss/ModexApply' }, 'Source'),
        h('a', { href: 'board.html' }, 'Delivery board'),
        h('a', { href: 'https://github.com/Delviss/ModexApply/blob/main/docs/architecture.md' }, 'Architecture'),
        h('a', { href: 'https://github.com/Delviss/ModexApply/blob/main/docs/guide-safety.md' }, 'Guide safety'),
        h('a', { href: 'https://github.com/Delviss/ModexApply/blob/main/docs/privacy.md' }, 'Privacy'),
        button('Reset this browser’s data', async () => {
          resetLocalState();
          location.hash = '#/';
        }, 'ghost', { class: 'btn btn-ghost btn-sm' })),
      h('p', {},
        'Modex Apply is not an education agent, an immigration adviser or an admissions decision maker. ',
        'Universities decide admission; governments decide visas. Guides are current students, never staff, ',
        'and never collect tuition or application fees.')));
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

  for (const anchor of document.querySelectorAll('#primary-nav a')) {
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
