import { h, link, badge, button } from '../ui.js';
import { store, institutions, programmes, guides, registerEntries } from '../store.js';
import { isGuideDiscoverable } from '../engine.js';

/**
 * The front door.
 *
 * Laid out against the shape a study-abroad marketplace homepage has — one
 * centred promise over a search, a destination rail, three audiences, a
 * how-it-works and a closing band — because a student comparing this with an
 * agent marketplace should not have to learn a new page to do it.
 *
 * The claims are where it departs. The incumbent pattern opens with a scale
 * number and a row of stock-photo faces; every count on this page is computed
 * from the data in the repository, carries the source it came from, and says
 * when it is sample data. A platform whose argument is that claims carry
 * sources cannot open with claims that carry none.
 */
export function homeView() {
  const allProgrammes = programmes();
  const register = registerEntries();
  const verified = institutions().filter((one) => one.verification.state === 'verified');
  const discoverable = guides().filter((guide) => isGuideDiscoverable(guide.state));

  return h('div', {},
    hero(register, allProgrammes, discoverable),
    audiences(),
    journey(),
    walkthroughs(),
    limits(verified),
    ctaBand());
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function hero(register, allProgrammes, discoverable) {
  const search = h('input', {
    type: 'search',
    id: 'hero-search',
    class: 'lp-search__input',
    placeholder: 'Try "computer science" or "public health"',
    'aria-label': 'Search programmes',
  });
  const go = () => {
    location.hash = `#/programmes?q=${encodeURIComponent(search.value.trim())}`;
  };

  return h('section', { class: 'hero lp-hero' },
    h('div', { class: 'lp-hero__body' },
      badge('Apply direct. Ask students. Save more.', 'brand'),
      h('h1', { class: 'lp-hero__title' },
        'Apply directly. Ask students who already study there.'),
      h('p', { class: 'lp-hero__subtitle' },
        'No agent in the middle. The university is the source of truth for what it charges and what ',
        'it requires; the people answering your questions about the city, the coursework and the cost ',
        'of living are current students, verified against evidence that expires.'),
      h('form', {
        class: 'lp-search',
        role: 'search',
        onSubmit: (event) => { event.preventDefault(); go(); },
      },
        search,
        button('Search programmes', go, 'primary', { type: 'submit' })),
      h('p', { class: 'lp-hero__disclaimer' },
        'Modex does not make admission decisions and does not guarantee visas, admissions, jobs or ',
        'scholarships. Universities decide admission; governments decide visas.'),
      h('div', { class: 'lp-proof' },
        proofPoint(String(register.length), 'Universities in the register',
          'Real institutions, identity facts only. None is a partner yet.'),
        proofPoint(String(allProgrammes.length), 'Programmes published',
          'Sample catalogue, each with machine-readable requirements.'),
        proofPoint(String(discoverable.length), 'Guides discoverable now',
          'Sample network. A guide whose evidence lapses leaves this count.'))),
    destinationRail(register, allProgrammes));
}

function proofPoint(value, label, source) {
  return h('div', { class: 'lp-proof__point' },
    h('span', { class: 'lp-proof__value' }, value),
    h('span', { class: 'lp-proof__label' }, label),
    h('span', { class: 'lp-proof__source' }, source));
}

const COUNTRY_NAMES = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  NL: 'Netherlands',
  DE: 'Germany',
  CA: 'Canada',
  AU: 'Australia',
  LV: 'Latvia',
};

/**
 * The destination rail.
 *
 * Every tile is computed from the register and the catalogue, and says both
 * numbers — because "8 universities entered, 0 programmes" is the distinction
 * this platform exists to keep visible: a register entry is a publicly
 * verifiable name, not a partner with a catalogue. A tile that showed only the
 * bigger number would be the agent-marketplace move.
 */
function destinationRail(register, allProgrammes) {
  const byCountry = new Map();
  for (const entry of register) {
    const bucket = byCountry.get(entry.country) ?? { entries: 0, cities: [] };
    bucket.entries += 1;
    if (!bucket.cities.includes(entry.city)) bucket.cities.push(entry.city);
    byCountry.set(entry.country, bucket);
  }

  const destinations = [...byCountry.entries()]
    .sort((left, right) => right[1].entries - left[1].entries)
    .map(([code, bucket]) => {
      const published = allProgrammes.filter((one) => one.institution.country === code).length;
      return h('a', { class: 'lp-destination', href: `#/programmes?country=${code}` },
        h('span', { class: 'lp-destination__code', 'aria-hidden': 'true' }, code),
        h('span', { class: 'lp-destination__name' }, COUNTRY_NAMES[code] ?? code),
        h('span', { class: 'lp-destination__detail' }, bucket.cities.slice(0, 3).join(' · ')),
        h('span', { class: 'lp-destination__meta' },
          `${bucket.entries} in the register · ${published} sample programme${published === 1 ? '' : 's'}`));
    });

  return marquee(destinations, 'Study destinations in the institution register');
}

/**
 * A continuously scrolling rail.
 *
 * Three rules it keeps, and the vendor carousel this replaces kept none of
 * them: `prefers-reduced-motion` never starts it, there is an explicit pause
 * control because WCAG 2.2.2 requires one for anything that moves for more
 * than five seconds, and pausing drops to the still, scrollable row rather than
 * freezing a transform mid-flight — so every card stays reachable once it
 * stops. The second copy of the set exists only to make the loop seamless and
 * is hidden from assistive technology.
 */
function marquee(items, label) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const viewport = h('div', { class: 'lp-marquee__viewport' });
  const region = h('section', { class: 'lp-marquee', 'aria-label': label }, viewport);

  const render = (still) => {
    region.dataset.still = String(still);
    viewport.replaceChildren();
    // A row somebody has to scroll by hand needs to be reachable from the
    // keyboard; one that scrolls itself must not become a tab stop.
    if (still) viewport.tabIndex = 0;
    else viewport.removeAttribute('tabindex');
    viewport.append(track(items));
    if (!still) viewport.append(track(items.map((item) => item.cloneNode(true)), true));
  };

  render(reduced);

  if (!reduced) {
    let paused = false;
    const toggle = h('button', {
      type: 'button',
      class: 'lp-marquee__toggle',
      'aria-pressed': 'false',
      onClick: () => {
        paused = !paused;
        toggle.textContent = paused ? 'Resume the scrolling row' : 'Pause the scrolling row';
        toggle.setAttribute('aria-pressed', String(paused));
        render(paused);
      },
    }, 'Pause the scrolling row');
    region.append(toggle);
  }

  return region;
}

function track(items, echo = false) {
  const list = h('ul', { class: 'lp-marquee__track', ...(echo ? { 'aria-hidden': 'true' } : {}) },
    items.map((item) => h('li', { class: 'lp-marquee__item' }, item)));
  // A tile inside the echo is a duplicate link, so it leaves the tab order too.
  if (echo) for (const anchor of list.querySelectorAll('a')) anchor.tabIndex = -1;
  return list;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function section(tone, eyebrow, title, description, ...children) {
  return h('section', { class: 'lp-section', dataset: { tone } },
    h('div', { class: 'wrap lp-section__inner' },
      h('div', { class: 'lp-section__head' },
        h('span', { class: 'kicker' }, eyebrow),
        h('h2', {}, title),
        description ? h('p', { class: 'lp-section__description' }, description) : null),
      ...children));
}

function audiences() {
  return section('canvas', 'Who this is for',
    'Three jobs an agent bundles into one commission',
    'An education agent is paid by the university for the enrolment, then advises the student on ' +
      'where to apply. Separating the three jobs is the whole product.',
    h('div', { class: 'grid grid-3' },
      audienceCard('Students', 'Apply direct, and keep what you build',
        'Search programmes on what they actually require, see what each one costs and when it closes, and submit to the university yourself.',
        [
          'Your documents stay yours, and you can see who has read them',
          'Every requirement is checked against your profile, with the remedy for anything missing',
          'A submission counts when the university confirms receipt, not when a payload is generated',
        ],
        '/programmes', 'Search programmes'),
      audienceCard('Universities', 'Applications that arrive complete',
        'A verified partner publishes its own requirements, fees and deadlines, and receives applications against them.',
        [
          'A signed contract, a confirmed domain and a named signatory — or there is no badge',
          'Every published figure carries the date the institution last updated it',
          'Entering a university is evidence per stage, and the last stage asks for a second factor',
        ],
        '/admin/university', 'Open the intake console'),
      audienceCard('Student guides', 'Paid by us, never by you',
        'Current students answer questions about the coursework, the city and the real cost of living, verified against evidence that expires.',
        [
          'A guide cannot collect tuition or application fees, and cannot apply on your behalf',
          'Verification lapses unless it is renewed, and a lapsed guide stops being discoverable',
          'Every message is scanned; a payment request opens a trust case rather than reaching you quietly',
        ],
        '/guides', 'Meet the guides')));
}

function audienceCard(audience, title, body, points, href, cta) {
  return h('article', { class: 'card lp-audience' },
    h('span', { class: 'kicker' }, audience),
    h('h3', {}, title),
    h('p', { class: 'muted small' }, body),
    h('ul', { class: 'lp-audience__points' }, points.map((point) => h('li', {}, point))),
    h('p', { class: 'lp-audience__action' }, link(href, cta)));
}

function journey() {
  const steps = [
    ['Search on what programmes require', 'The platform',
      'Rule-based, explainable matching against requirements the university published. Every fee and deadline shows when it was last confirmed, and a figure we cannot vouch for is withheld rather than shown.'],
    ['Check your eligibility, per requirement', 'The platform',
      'A pass, a fail, an unknown or a missing document — never a single verdict. An absence is not a rejection: a transcript you have not uploaded makes you unassessed, not ineligible.'],
    ['Apply directly to the university', 'You',
      'Tasks, three separately-worded consents and an immutable snapshot of exactly what was sent. You can reproduce your own submission, byte for byte, months later.'],
    ['Track it to a confirmed receipt', 'You and the university',
      'The university returns its own reference. Until then the application is submitted, not received — and the page says so in those words.'],
  ];

  return section('surface', 'How it works', 'Four steps, and you own all four',
    'Nothing here happens on your behalf in a room you cannot see.',
    h('ol', { class: 'lp-journey' },
      steps.map(([title, owner, body], index) =>
        h('li', { class: 'lp-journey__step' },
          h('span', { class: 'lp-journey__index', 'aria-hidden': 'true' }, String(index + 1)),
          h('div', { class: 'stack-sm' },
            h('h3', {}, title),
            h('span', { class: 'lp-journey__owner' }, owner),
            h('p', { class: 'muted small' }, body))))));
}

function walkthroughs() {
  return section('canvas', 'The build itself', 'What this build actually does',
    'This is the product, not a slide deck. The pages below run the platform’s own rule code — the ' +
      'eligibility evaluators, the guide matching weights, the anti-scam scanner and the application ' +
      'state machine are imported from the same modules the API runs.',
    h('div', { class: 'grid grid-2' },
      walkthrough('Search and compare', '/programmes',
        'Filter the catalogue, see a provenance stamp on every fee and deadline, and watch a stale price be withheld rather than shown.'),
      walkthrough('Check your eligibility', '/programmes/example-msc-computer-science',
        'A per-requirement verdict against the demo profile, with the remedy for anything missing. An absence is never a rejection.'),
      walkthrough('Apply directly', '/apply/example-msc-computer-science',
        'Tasks, three separately-worded consents, an immutable snapshot and a receipt with the university’s own reference.'),
      walkthrough('Talk to a guide safely', '/messages',
        'The anti-scam pipeline runs on every message as you type it. Try a payment request and watch the trust case open.'),
      walkthrough('See verified savings', '/savings',
        'Scholarships, waivers and discounts with a verifier and a validity period. Unverified claims never count toward a total.'),
      walkthrough('Run the consoles', '/admin',
        'University intake, catalogue, trust, operations and finance — including entering a new university against the evidence rules.')));
}

function walkthrough(title, href, body) {
  return h('article', { class: 'stack-sm' },
    h('h3', {}, link(href, title)),
    h('p', { class: 'muted small' }, body));
}

function limits(verified) {
  return section('tinted', 'The line', 'What this platform will not do',
    null,
    h('p', {},
      'No guarantee of a visa, an admission, a job or a salary. No payment recipient hidden behind a ',
      'generic "processing" label. No guide collecting tuition or application fees. No submission ',
      'reported as successful because a payload was generated — only because the university confirmed ',
      'receipt and returned a reference.'),
    h('p', { class: 'small muted' },
      `Sample catalogue: ${verified.length} verified partner institutions, used so the whole journey `,
      'can be walked without attributing an invented tuition figure to a real university. Built ',
      store.seed.builtAt, ' · ',
      h('a', { href: 'https://github.com/Delviss/ModexApply' }, 'source on GitHub'), ' · ',
      h('a', { href: 'board.html' }, 'delivery board')));
}

function ctaBand() {
  return h('section', { class: 'lp-cta' },
    h('div', { class: 'lp-cta__inner' },
      h('h2', {}, 'Start with a programme, not a sales call'),
      h('p', {}, 'Search the catalogue, check what you would need, and ask a current student before you commit to anything.'),
      h('div', { class: 'row lp-cta__actions' },
        link('/programmes', 'Browse programmes', { class: 'btn lp-cta__primary' }),
        link('/questions', 'Read questions students actually asked', { class: 'lp-cta__link' })),
      h('p', { class: 'lp-cta__footnote' }, 'Free to search. No agent will call you.')));
}
