import { h, svg, link, badge, button } from '../ui.js';
import {
  store, institutions, programmes, guides, registerEntries, questions, guideById, institutionById,
  VERDICT_LABELS, VERDICT_TONES,
} from '../store.js';
import { isGuideDiscoverable } from '../engine.js';
import { verificationBadge, sampleChip } from './components.js';

/**
 * The front door.
 *
 * Laid out against the shape a study-abroad marketplace homepage has — a
 * two-up hero over a search, a scrolling destination rail, a split feature, an
 * orbit of the platform's own sections, three audiences, a how-it-works, real
 * guide answers, the verified partners, a closing band and an FAQ — because a
 * student comparing this with an agent marketplace should not have to learn a
 * new page shape to do it.
 *
 * The claims are where it departs. The incumbent pattern opens with a scale
 * number, a row of stock-photo faces and an invented acceptance rate; every
 * count on this page is computed from the data in the repository, carries the
 * source it came from, and says when it is sample data. A platform whose
 * argument is that claims carry sources cannot open with claims that carry
 * none — so the hero's floating card shows a real product mechanic (four
 * verdicts, never one) instead of a number nobody could check.
 */
export function homeView() {
  const allProgrammes = programmes();
  const register = registerEntries();
  const verified = institutions().filter((one) => one.verification.state === 'verified');
  const discoverable = guides().filter((guide) => isGuideDiscoverable(guide.state));

  return h('div', {},
    hero(register, allProgrammes, discoverable, verified),
    discoverFeature(allProgrammes),
    solutionsOrbit(),
    audiences(),
    journey(),
    voices(),
    verifiedPartners(),
    limits(verified),
    faq(),
    ctaBand());
}

// ---------------------------------------------------------------------------
// Icons — a small stroke set, at the header's weight, built once and reused
// across the page so a visitor learns each shape a single time.
// ---------------------------------------------------------------------------

function icon(children, size = 20) {
  return svg('svg', {
    class: 'icon', viewBox: '0 0 24 24', width: String(size), height: String(size),
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  }, ...children);
}

const ICONS = {
  search: (size) => icon([svg('circle', { cx: '11', cy: '11', r: '6.5' }), svg('path', { d: 'M20 20l-4.3-4.3' })], size),
  shield: (size) => icon([
    svg('path', { d: 'M12 3.4l7.2 2.9v5.5c0 4.6-3.1 7.9-7.2 8.8-4.1-.9-7.2-4.2-7.2-8.8V6.3z' }),
    svg('path', { d: 'M9 12.2l2.1 2.1 4-4.3' }),
  ], size),
  send: (size) => icon([svg('path', { d: 'M4 12.5l16-8.3-6.3 16.3-2.9-6.2z' }), svg('path', { d: 'M13.6 14.3L20 4.2' })], size),
  chat: (size) => icon([svg('path', { d: 'M4 5.3h16v10.1H9.3L4.8 19v-3.6H4z' })], size),
  compass: (size) => icon([svg('circle', { cx: '12', cy: '12', r: '8.4' }), svg('path', { d: 'M14.7 9.3l-1.9 4.4-4.5 1.9 1.9-4.4z' })], size),
  savings: (size) => icon([
    svg('rect', { x: '3.4', y: '7.2', width: '17.2', height: '11', rx: '2.2' }),
    svg('path', { d: 'M3.4 10.6h17.2' }), svg('path', { d: 'M7.6 4.4h8.8' }),
  ], size),
  sliders: (size) => icon([
    svg('path', { d: 'M4.5 6h15M4.5 12h15M4.5 18h15' }),
    svg('circle', { cx: '9', cy: '6', r: '1.6', fill: 'currentColor', stroke: 'none' }),
    svg('circle', { cx: '15.5', cy: '12', r: '1.6', fill: 'currentColor', stroke: 'none' }),
    svg('circle', { cx: '10.5', cy: '18', r: '1.6', fill: 'currentColor', stroke: 'none' }),
  ], size),
  check: (size) => icon([svg('path', { d: 'M5 12.6l4.4 4.4L19 7.4' })], size),
  chevron: (size) => icon([svg('path', { d: 'M6 9l6 6 6-6' })], size),
  building: (size) => icon([
    svg('path', { d: 'M5 21V5.6L12 3l7 2.6V21' }), svg('path', { d: 'M3 21h18' }),
    svg('path', { d: 'M9.5 9h1.2M13.3 9h1.2M9.5 13h1.2M13.3 13h1.2M9.5 17h5' }),
  ], size),
  users: (size) => icon([
    svg('circle', { cx: '9', cy: '9', r: '3.1' }), svg('path', { d: 'M2.8 19c.7-3.1 3.1-5 6.2-5s5.5 1.9 6.2 5' }),
    svg('path', { d: 'M15.6 5.6c1.4.4 2.4 1.7 2.4 3.2 0 1.5-1 2.8-2.4 3.2' }),
    svg('path', { d: 'M16.6 14.3c2.4.5 4.1 2.2 4.6 4.7' }),
  ], size),
};

function iconChip(kind, size = 'md') {
  return h('span', { class: `lp-icon-chip lp-icon-chip--${size}` }, ICONS[kind](size === 'sm' ? 15 : 18));
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function hero(register, allProgrammes, discoverable, verified) {
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
    h('div', { class: 'wrap' },
      h('div', { class: 'lp-hero__grid' },
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
            'scholarships. Universities decide admission; governments decide visas.')),
        heroVisual()),
      proofRow(register, allProgrammes, discoverable, verified)),
    destinationRail(register, allProgrammes));
}

/** Brand-coloured tiles standing in for the usual stock-photo collage. */
function heroVisual() {
  return h('div', { class: 'lp-hero__visual', 'aria-hidden': 'true' },
    h('div', { class: 'lp-hero__tile lp-hero__tile--a' }, ICONS.search(30)),
    h('div', { class: 'lp-hero__tile lp-hero__tile--b' }, ICONS.shield(24)),
    h('div', { class: 'lp-hero__tile lp-hero__tile--c' }, ICONS.chat(24)),
    h('div', { class: 'lp-hero__tile lp-hero__tile--d' }, ICONS.send(22)),
    h('div', { class: 'lp-hero__tile lp-hero__tile--e' }, ICONS.compass(22)),
    h('div', { class: 'lp-hero__float' },
      h('span', { class: 'lp-hero__float-title' }, 'Every check, one of four verdicts'),
      h('div', { class: 'lp-hero__float-legend' },
        Object.keys(VERDICT_LABELS).map((verdict) => badge(shortVerdict(verdict), VERDICT_TONES[verdict])))));
}

const SHORT_VERDICT = { eligible: 'Meets it', likely_eligible: 'Likely', not_eligible: 'Fails it', insufficient_data: 'Unknown' };
const shortVerdict = (verdict) => SHORT_VERDICT[verdict] ?? VERDICT_LABELS[verdict];

function proofRow(register, allProgrammes, discoverable, verified) {
  return h('div', { class: 'lp-proof' },
    proofPoint('search', String(register.length), 'Universities in the register',
      'Real institutions, identity facts only. None is a partner yet.'),
    proofPoint('building', String(allProgrammes.length), 'Programmes published',
      'Sample catalogue, each with machine-readable requirements.'),
    proofPoint('users', String(discoverable.length), 'Guides discoverable now',
      'Sample network. A guide whose evidence lapses leaves this count.'),
    proofPoint('shield', String(verified.length), 'Verified partner institutions',
      'Contract, domain and signatory confirmed — the rest of the catalogue shows its stage plainly.'));
}

function proofPoint(iconKind, value, label, source) {
  return h('div', { class: 'lp-proof__point' },
    iconChip(iconKind, 'md'),
    h('div', { class: 'lp-proof__text' },
      h('span', { class: 'lp-proof__value' }, value),
      h('span', { class: 'lp-proof__label' }, label),
      h('span', { class: 'lp-proof__source' }, source)));
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

/**
 * The split feature.
 *
 * One real programme from the catalogue, shown the way the catalogue actually
 * renders it — a provenance stamp, published requirements, a fee that can be
 * withheld — because a mocked-up screenshot that promises more polish than
 * the product itself delivers is worse than none.
 */
function discoverFeature(allProgrammes) {
  const preview = allProgrammes.find((one) => one.visibility === 'visible') ?? allProgrammes[0] ?? null;

  return section('surface', 'Search', 'Search that starts from what the university actually requires',
    'Not a keyword match against a marketing blurb. Every listing carries the published requirements, the ' +
      'fee with the date it was last confirmed, and the deadline for the intake you would apply into.',
    h('div', { class: 'lp-feature' },
      h('div', {},
        h('ul', { class: 'lp-feature__points' },
          featurePoint('search', 'Filter on requirements, not marketing copy',
            'Level, field, duration, mode and country — the same facts the university publishes.'),
          featurePoint('shield', 'A provenance stamp on every fee and deadline',
            'When it was confirmed, when it expires, and the source reference behind it.'),
          featurePoint('check', 'A stale figure is withheld, never shown',
            'A wrong price is worse than an absent one — so an expired fee disappears rather than misleads.')),
        h('p', { class: 'lp-feature__actions' }, link('/programmes', 'Search the catalogue', { class: 'btn btn-primary' }))),
      preview ? featurePreview(preview) : null));
}

function featurePoint(iconKind, title, body) {
  return h('li', {},
    iconChip(iconKind, 'sm'),
    h('p', {}, h('strong', {}, title), h('span', {}, body)));
}

function featurePreview(programme) {
  const institution = programme.institution;
  const requirements = (programme.requirements ?? []).slice(0, 2);
  return h('div', { class: 'lp-feature__panel' },
    h('div', { class: 'lp-feature__card' },
      h('div', { class: 'lp-feature__card-head' },
        h('div', { class: 'stack-sm' },
          h('h3', {}, programme.name),
          h('p', { class: 'small muted' }, institution.displayName, ' · ', institution.city, ', ', institution.country)),
        verificationBadge(institution)),
      requirements.length > 0
        ? h('ul', { class: 'lp-feature__checks' },
            requirements.map((requirement) =>
              h('li', {}, ICONS.check(15), h('span', {}, requirement.humanSummary))))
        : null,
      h('p', { class: 'small muted' },
        `${(programme.requirements ?? []).length} published requirement${(programme.requirements ?? []).length === 1 ? '' : 's'}`),
      h('div', { class: 'row' }, sampleChip())),
    h('div', { class: 'lp-feature__float' },
      h('span', { class: 'lp-feature__float-title' }, 'Explainable, not a black box'),
      h('div', { class: 'lp-feature__float-legend' },
        Object.keys(VERDICT_LABELS).map((verdict) => badge(shortVerdict(verdict), VERDICT_TONES[verdict])))));
}

const SOLUTIONS = [
  ['search', 'Search and compare', '/programmes',
    'Filter the catalogue, see a provenance stamp on every fee and deadline, and watch a stale price be withheld rather than shown.'],
  ['compass', 'Check your eligibility', '/programmes/example-msc-computer-science',
    'A per-requirement verdict against the demo profile, with the remedy for anything missing. An absence is never a rejection.'],
  ['send', 'Apply directly', '/apply/example-msc-computer-science',
    'Tasks, three separately-worded consents, an immutable snapshot and a receipt with the university’s own reference.'],
  ['chat', 'Talk to a guide safely', '/messages',
    'The anti-scam pipeline runs on every message as you type it. Try a payment request and watch the trust case open.'],
  ['savings', 'See verified savings', '/savings',
    'Scholarships, waivers and discounts with a verifier and a validity period. Unverified claims never count toward a total.'],
  ['sliders', 'Run the consoles', '/admin',
    'University intake, catalogue, trust, operations and finance — including entering a new university against the evidence rules.'],
];

/**
 * The solutions orbit.
 *
 * A ring of the platform's own six sections around a centre mark, in the slot
 * this pattern usually gives a stock photo of a smiling student. What sits at
 * the centre here is the brand mark, because nothing about "everything from
 * search to submission" is a person — it is the rule code underneath every
 * node, imported from the same modules the API runs.
 */
function solutionsOrbit() {
  const nodes = SOLUTIONS.map(([kind, title], index) =>
    h('a', {
      class: 'lp-orbit__node',
      href: `#${SOLUTIONS[index][2]}`,
      style: `--a:${Math.round((360 / SOLUTIONS.length) * index)}deg; --r:158px;`,
    }, ICONS[kind](20), h('span', {}, title)));

  return section('canvas', 'The build itself', 'Every solution, from search to submission',
    'This is the product, not a slide deck. The pages below run the platform’s own rule code — the ' +
      'eligibility evaluators, the guide matching weights, the anti-scam scanner and the application ' +
      'state machine are imported from the same modules the API runs.',
    h('div', { class: 'lp-orbit' },
      h('div', { class: 'lp-orbit__ring', 'aria-hidden': 'true' }),
      h('div', { class: 'lp-orbit__core', 'aria-hidden': 'true' }, 'Modex Apply'),
      ...nodes),
    h('div', { class: 'grid grid-2 lp-solutions__grid' },
      SOLUTIONS.map(([kind, title, href, body]) => solutionItem(kind, title, href, body))));
}

function solutionItem(kind, title, href, body) {
  return h('article', { class: 'lp-solutions__item' },
    iconChip(kind, 'sm'),
    h('div', { class: 'stack-sm' },
      h('h3', {}, link(href, title)),
      h('p', { class: 'muted small' }, body)));
}

function audiences() {
  return section('surface', 'Who this is for',
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

  return section('tinted', 'How it works', 'Four steps, and you own all four',
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

/**
 * Real answers from the guide network, in place of invented testimonials.
 *
 * The incumbent pattern's quotes are unverifiable by design — a name, a face,
 * a line no reader can check. These are pulled from the same `questions()`
 * data the `/questions` page runs, each one still carrying its guide, its
 * programme and its own helpful count, and each one marked as sample data
 * because the guide network behind it is.
 */
function voices() {
  // One answer per guide — the network's whole point is more than one current
  // student behind the badge, so the busiest guide should not fill the row.
  const byGuide = new Map();
  for (const entry of questions()) {
    if (entry.moderationState !== 'approved') continue;
    const best = byGuide.get(entry.guideId);
    if (!best || entry.helpfulCount > best.helpfulCount) byGuide.set(entry.guideId, entry);
  }
  const picks = [...byGuide.values()].sort((left, right) => right.helpfulCount - left.helpfulCount).slice(0, 3);

  if (picks.length === 0) return null;

  return section('surface', 'From the guide network', 'What a guide told the last student who asked',
    'Every answer below is one current student’s own experience, not a verified fact — the page says so, ' +
      'and so does every answer. Read more, or ask your own question, on the questions page.',
    h('div', { class: 'lp-voices' }, picks.map(voiceCard)),
    h('p', {}, link('/questions', 'Read more questions students actually asked')));
}

function voiceCard(entry) {
  const guide = guideById(entry.guideId);
  const institution = guide ? institutionById(guide.institutionId) : null;
  const initials = guide
    ? guide.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('')
    : '?';

  return h('article', { class: 'lp-voice' },
    h('span', { class: 'lp-voice__mark', 'aria-hidden': 'true' }, '“'),
    h('p', { class: 'lp-voice__text' }, entry.answer),
    h('div', { class: 'lp-voice__footer' },
      h('div', { class: 'lp-voice__who' },
        h('span', { class: 'lp-voice__avatar', 'aria-hidden': 'true' }, initials),
        h('div', { class: 'lp-voice__name-role' },
          h('span', { class: 'lp-voice__name' }, guide ? link(`/guides/${guide.id}`, guide.displayName) : 'A student guide'),
          h('span', { class: 'lp-voice__role' },
            guide ? `${guide.programName} · ${institution?.displayName ?? ''}` : ''))),
      h('span', { class: 'lp-voice__helpful' }, `${entry.helpfulCount} students found this helpful`)));
}

/**
 * The verified partner cards.
 *
 * All three catalogue institutions, not only the verified two — a pending
 * institution shown mid-pipeline is a better demonstration of the trust
 * system than hiding it would be. The monogram tile stands in for a campus
 * photograph none of these fictional institutions has.
 */
function verifiedPartners() {
  const all = institutions();
  if (all.length === 0) return null;

  return section('canvas', 'In the catalogue', 'Partner institutions, at whatever stage they have reached',
    'A verification badge here means a signed contract, a confirmed domain and a named signatory — never ' +
      'a stage in progress presented as done.',
    h('div', { class: 'lp-partners' }, all.map(partnerCard)));
}

function partnerCard(inst) {
  const monogram = inst.displayName
    .split(/\s+/)
    .filter((word) => !['of', 'the', 'and', 'for'].includes(word.toLowerCase()))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

  return h('a', { class: 'lp-partner', href: `#/institutions/${inst.id}` },
    h('div', { class: 'lp-partner__band' }, h('span', { class: 'lp-partner__mark' }, monogram)),
    h('div', { class: 'lp-partner__body' },
      h('h3', {}, inst.displayName),
      h('p', { class: 'lp-partner__meta' }, inst.city, ', ', inst.country),
      h('p', { class: 'lp-partner__desc' }, truncate(inst.description, 140)),
      h('div', { class: 'chips lp-partner__chips' }, verificationBadge(inst), sampleChip())));
}

function truncate(text, max) {
  if (!text || text.length <= max) return text ?? '';
  return `${text.slice(0, max).trimEnd()}…`;
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

const FAQS = [
  ['How is this different from using an education agent?', [
    'An agent is paid by the university when you enrol, then advises you on where to apply — one person, ',
    'two incompatible jobs. Modex splits them: the platform matches you against published requirements and ',
    'never receives an enrolment commission; a verified student guide answers questions and never touches ',
    'your tuition; the university decides admission on its own application.',
  ].join('')],
  ['How do you decide whether I am eligible?', [
    'Rule-based checks against the requirements the university itself published, run per requirement rather ',
    'than as one verdict. Each check comes back as a pass, a fail, an unknown or a missing document — a ',
    'transcript you have not uploaded yet makes you unassessed, never rejected.',
  ].join('')],
  ['Can a student guide ask me for money?', [
    'No. Guides are current students, verified against evidence that expires, and they are paid by Modex — ',
    'never by you. Every message is scanned as you type it; a payment request opens a trust case rather than ',
    'reaching you quietly, and a guide who tries it is suspended.',
  ].join('')],
  ['What actually happens when I submit an application?', [
    'You work through tasks, sign three separately-worded consents, and the platform freezes an immutable ',
    'snapshot of exactly what will be sent — reproducible byte for byte, months later. The application is ',
    '"submitted" the moment it leaves; it only becomes "received" once the university confirms it and returns ',
    'its own reference.',
  ].join('')],
  ['Does anything I enter here leave my device?', [
    'Not in this public build. It runs entirely in your browser — your profile, documents and messages are ',
    'held in local storage on this device and nowhere else. The institution register is real; the rest of the ',
    'catalogue is sample data kept separate from it precisely so a sample figure can never be mistaken for one.',
  ].join('')],
];

function faq() {
  return section('surface', 'Questions', 'Before you apply direct',
    null,
    h('div', { class: 'lp-faq' },
      FAQS.map(([question, answer]) =>
        h('details', {},
          h('summary', {}, h('span', {}, question), ICONS.chevron(18)),
          h('p', { class: 'lp-faq__answer' }, answer)))));
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
