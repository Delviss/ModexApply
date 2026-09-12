import { h, link, badge, card, kpi, button } from '../ui.js';
import { store, institutions, programmes, guides, registerEntries } from '../store.js';
import { isGuideDiscoverable } from '../engine.js';

export function homeView() {
  const allProgrammes = programmes();
  const verified = institutions().filter((one) => one.verification.state === 'verified');
  const discoverable = guides().filter((guide) => isGuideDiscoverable(guide.state));

  return h('div', {},
    hero(),
    h('div', { class: 'wrap stack', style: 'margin-top:28px' },
      h('div', { class: 'grid grid-3' },
        kpi('Institutions in the register', String(registerEntries().length), 'Real universities, identity facts only'),
        kpi('Verified partners', String(verified.length), 'Sample institutions with a signed partnership'),
        kpi('Programmes published', String(allProgrammes.length), 'Each with machine-readable requirements'),
        kpi('Verified guides', String(discoverable.length), 'Current students, evidence with an expiry')),

      h('section', { class: 'stack' },
        h('h2', {}, 'Three jobs an agent bundles into one commission'),
        h('div', { class: 'grid grid-3' },
          job('Finding the right programme', 'The platform',
            'Rule-based, explainable matching against requirements the university published. Every figure carries where it came from and when it was last confirmed.',
            '/programmes', 'Search programmes'),
          job('Completing a correct application', 'You, on the platform',
            'You own the application and the documents. Every submission is reproducible from an immutable snapshot, and a submission counts only when the university confirms receipt.',
            '/applications', 'See an application'),
          job('Answers about life there', 'Verified current students',
            'Guides are verified against current-student evidence that expires. They cannot take money, promise admission or claim to speak for the university.',
            '/guides', 'Meet the guides'))),

      h('section', { class: 'card stack' },
        h('h2', {}, 'What this build actually does'),
        h('p', { class: 'muted' },
          'This is the product, not a slide deck: the pages below run the platform’s own rule code — ',
          'the eligibility evaluators, the guide matching weights, the anti-scam scanner and the application ',
          'state machine are imported from the same modules the API runs.'),
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
            'University intake, catalogue, trust, operations and finance — including entering a new university against the evidence rules.'))),

      h('section', { class: 'card tinted stack' },
        h('h2', {}, 'The line this platform will not cross'),
        h('p', {},
          'No guarantee of a visa, an admission, a job or a salary. No payment recipient hidden behind a generic ',
          '"processing" label. No guide collecting tuition or application fees. No submission reported as successful ',
          'because a payload was generated — only because the university confirmed receipt and returned a reference.'),
        h('p', { class: 'small muted' },
          'Built ', store.seed.builtAt, ' · ',
          h('a', { href: 'https://github.com/Delviss/ModexApply' }, 'source on GitHub'), ' · ',
          h('a', { href: 'board.html' }, 'delivery board')))));
}

function hero() {
  const search = h('input', {
    type: 'search',
    id: 'hero-search',
    placeholder: 'Try "computer science" or "public health"',
    'aria-label': 'Search programmes',
  });
  const go = () => {
    location.hash = `#/programmes?q=${encodeURIComponent(search.value.trim())}`;
  };

  const panel = h('aside', { class: 'card stack-sm', 'aria-label': 'Start here' },
    h('h2', { class: 'small' }, 'Start anywhere'),
    [
      ['/programmes', 'Search the catalogue', 'Filters, provenance, eligibility'],
      ['/guides', 'Meet a verified guide', 'Current students, evidence that expires'],
      ['/apply/example-msc-computer-science', 'Walk an application', 'Consents, snapshot, receipt'],
      ['/admin/university', 'Open the admin consoles', 'Enter a university against the evidence rules'],
    ].map(([href, label, blurb]) => h('p', { class: 'stack-sm', style: 'margin:0' },
      link(href, label),
      h('span', { class: 'small muted', style: 'display:block' }, blurb))));

  return h('section', { class: 'hero' },
    h('div', { class: 'wrap hero-grid' },
      h('div', { class: 'stack' },
      h('span', { class: 'kicker' }, 'Apply direct. Ask students. Save more.'),
      h('h1', {}, 'Apply directly to verified universities, with help from students who already study there.'),
      h('p', { class: 'lede' },
        'No agent in the middle. The university is the source of truth for what it charges and what it requires; ',
        'the people answering your questions about the city, the coursework and the cost of living are current ',
        'students, verified against evidence that expires.'),
      h('form', {
        class: 'row',
        style: 'margin-top:20px;max-width:620px',
        onSubmit: (event) => { event.preventDefault(); go(); },
      },
        h('div', { style: 'flex:1;min-width:220px' }, search),
        button('Search programmes', go, 'primary', { type: 'submit' })),
      h('div', { class: 'row small muted' },
        badge('Verification with an expiry', 'success'),
        badge('Provenance on every figure', 'info'),
        badge('Immutable submission snapshots', 'brand'),
        badge('Anti-scam on every message', 'warning'))),
      panel));
}

function job(title, owner, body, href, cta) {
  return h('article', { class: 'card stack-sm' },
    h('span', { class: 'kicker' }, owner),
    h('h3', {}, title),
    h('p', { class: 'muted small' }, body),
    h('p', {}, link(href, cta)));
}

function walkthrough(title, href, body) {
  return h('article', { class: 'stack-sm' },
    h('h3', {}, link(href, title)),
    h('p', { class: 'muted small' }, body));
}
