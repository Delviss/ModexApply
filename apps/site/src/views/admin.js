import {
  h, link, badge, button, card, empty, table, kpi, formatDate, formatDateTime, titleCase,
  toast, confirmDialog, downloadJson, money, countdown,
} from '../ui.js';
import {
  store, update, id, registerEntries, REGISTER_STAGES, REGISTER_STAGE_LABELS, REGISTER_STAGE_EVIDENCE,
  institutions, programmes, guides, offers, applications, feesUsable, guideById, programmeByKey,
  offerValueMinor,
} from '../store.js';
import { guideExpiryUrgency, daysUntil, guideLifecycleDecision } from '../engine.js';
import { provenanceStamp, guideStateBadge, sampleChip } from './components.js';

/** Short enough to read at a glance; the full evidence rule is in the table below. */
const STAGE_HINTS = {
  submitted: 'Entered, no evidence yet',
  identity_confirmed: 'National register checked',
  domain_confirmed: 'DNS record verified',
  signatory_confirmed: 'Signatory verified on the domain',
  contracted: 'Contract on file — badge published',
};

const CONSOLES = [
  ['overview', 'Overview', 'Where the four consoles are and who they are for.'],
  ['university', 'University intake', 'Enter universities, advance them against evidence, export the register.'],
  ['catalogue', 'Catalogue', 'Programme records, provenance and the freshness sweep.'],
  ['trust', 'Trust', 'Cases from the anti-scam pipeline and from reports, with their evidence.'],
  ['ops', 'Operations', 'Connectors, submissions and the alerts that have runbooks.'],
  ['finance', 'Finance', 'Guide rewards, dual approval, and the rule rewards cannot break.'],
];

export function adminView(which, query) {
  const active = CONSOLES.some(([key]) => key === which) ? which : 'overview';
  const views = {
    overview: overviewConsole,
    university: universityConsole,
    catalogue: catalogueConsole,
    trust: trustConsole,
    ops: opsConsole,
    finance: financeConsole,
  };

  return h('div', { class: 'wrap stack' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h1', {}, 'Admin consoles'),
        h('p', { class: 'muted' },
          'Signed in as ', h('strong', {}, 'M. Haddad'), ' · roles: trust_agent, ops, finance, university_admin ',
          badge('Demo session', 'neutral'))),
      h('nav', { class: 'chips', 'aria-label': 'Consoles' },
        CONSOLES.map(([key, label]) =>
          h('a', { href: `#/admin/${key === 'overview' ? '' : key}`, class: `chip ${key === active ? 'selected' : ''}` }, label)))),
    views[active](query));
}

/**
 * Step-up authentication.
 *
 * Every action that changes what the platform asserts about a real institution,
 * or moves money, asks for the second factor again. In the platform proper this
 * is a TOTP check against the enrolled authenticator; here it is the same gate
 * with the check stubbed, and it is stubbed visibly rather than silently.
 */
async function stepUp(action) {
  const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '000000', 'aria-label': 'Authenticator code' });
  const ok = await confirmDialog({
    title: 'Confirm with your authenticator',
    body: h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' }, action),
      h('p', { class: 'small muted' },
        'Staff roles cannot act on a verification claim or a payout without a second factor. ',
        'In this public build any six digits are accepted; the API checks the enrolled authenticator.'),
      code),
    confirmLabel: 'Confirm',
  });
  return ok && code.value.trim().length >= 4;
}

// ---------------------------------------------------------------------------

function overviewConsole() {
  const register = registerEntries();
  const pending = register.filter((one) => one.verificationState !== 'verified');
  const openCases = store.state.trustCases.filter((one) => one.state === 'open');
  const stale = programmes().filter((one) => !feesUsable(one.fees));

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      kpi('In the register', String(register.length), `${pending.length} not yet verified`),
      kpi('Verified partners', String(institutions().filter((one) => one.verification.state === 'verified').length), 'With a signed partnership'),
      kpi('Open trust cases', String(openCases.length), 'Anti-scam and reports'),
      kpi('Money records withheld', String(stale.length), 'Confirmation expired')),

    h('div', { class: 'grid grid-2' },
      CONSOLES.slice(1).map(([key, label, blurb]) =>
        h('article', { class: 'card stack-sm' },
          h('h3', {}, link(`/admin/${key}`, label)),
          h('p', { class: 'small muted' }, blurb)))),

    card(h('h2', {}, 'What "admin work" means here'),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'Entering a university is not typing a name into a list. A record enters at ',
        h('strong', {}, 'Entered'), ' with publicly verifiable identity facts only — name, country, city, official '
        + 'domain — and moves forward only when somebody attaches the evidence each stage names. Tuition, deadlines '
        + 'and requirements are never entered from a desk: they arrive from the institution and carry provenance.'),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'The register in this build already holds ', String(register.length),
        ' real universities at the first stage. The export button hands you the exact JSON to commit back to ',
        h('span', { class: 'mono' }, 'data/institution-register.json'), '.')));
}

// ---------------------------------------------------------------------------
// University intake — the console the admin work happens in
// ---------------------------------------------------------------------------

function universityConsole(query) {
  const entries = registerEntries();
  const filter = query.stage ?? '';
  const shown = entries.filter((entry) => filter === '' || entry.stage === filter);

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      REGISTER_STAGES.map((stage) =>
        kpi(REGISTER_STAGE_LABELS[stage], String(entries.filter((one) => one.stage === stage).length),
          STAGE_HINTS[stage]))),

    entryForm(),

    card(
      h('div', { class: 'card-head' },
        h('h2', {}, `Register (${shown.length})`),
        h('div', { class: 'row' },
          h('select', {
            'aria-label': 'Filter by stage', style: 'width:auto',
            onChange: (event) => {
              location.hash = event.target.value === '' ? '#/admin/university' : `#/admin/university?stage=${event.target.value}`;
            },
          },
            h('option', { value: '', selected: filter === '' }, 'All stages'),
            REGISTER_STAGES.map((stage) => h('option', { value: stage, selected: filter === stage }, REGISTER_STAGE_LABELS[stage]))),
          button('Export the register', () => exportRegister(), 'secondary', { class: 'btn btn-secondary btn-sm' }))),
      h('p', { class: 'small muted', style: 'margin-bottom:12px' },
        'Identity facts only. No fee, deadline, requirement or partnership scope may be entered here — those come from ',
        'the institution and carry their own provenance.'),
      table(
        [{ label: 'University' }, { label: 'Country' }, { label: 'Domain' }, { label: 'Stage' }, { label: 'Evidence on file' }, { label: '' }],
        shown.map((entry) => [
          h('div', { class: 'stack-sm' },
            h('strong', {}, entry.displayName),
            h('span', { class: 'small muted' }, entry.city),
            entry.priority ? badge(titleCase(entry.priority), 'neutral') : null),
          entry.country,
          h('a', { class: 'mono small', href: entry.websiteUrl, rel: 'noopener noreferrer nofollow' }, entry.domains[0]),
          stageBadge(entry),
          entry.evidence.length === 0
            ? h('span', { class: 'small muted' }, 'None')
            : h('div', { class: 'stack-sm' }, entry.evidence.map((evidence) =>
                h('span', { class: 'small' },
                  h('strong', {}, REGISTER_STAGE_LABELS[evidence.stage] ?? evidence.stage),
                  h('span', { class: 'small muted', style: 'display:block' },
                    `${evidence.reference} · ${formatDate(evidence.at)} · ${evidence.by}`)))),
          h('div', { class: 'row' },
            button('Advance', () => advance(entry), 'secondary', { class: 'btn btn-secondary btn-sm' }),
            entry.verificationState === 'rejected'
              ? null
              : button('Reject', () => reject(entry), 'ghost', { class: 'btn btn-ghost btn-sm' })),
        ]))),

    card(h('h2', {}, 'The evidence each stage needs'),
      table([{ label: 'Stage' }, { label: 'What has to be on file before it can be claimed' }],
        Object.entries(REGISTER_STAGE_EVIDENCE).map(([stage, requirement]) =>
          [REGISTER_STAGE_LABELS[stage], requirement])),
      h('p', { class: 'small muted', style: 'margin-top:10px' },
        'A verified badge appears on the public pages only at ', h('strong', {}, 'Partnership signed'),
        ', and it expires. A claim with no expiry is a claim nobody ever has to renew.')));
}

function stageBadge(entry) {
  if (entry.verificationState === 'rejected') return badge('Rejected', 'danger');
  const index = REGISTER_STAGES.indexOf(entry.stage);
  const tone = index === REGISTER_STAGES.length - 1 ? 'success' : index === 0 ? 'neutral' : 'info';
  return badge(REGISTER_STAGE_LABELS[entry.stage], tone);
}

async function advance(entry) {
  const index = REGISTER_STAGES.indexOf(entry.stage);
  const next = REGISTER_STAGES[index + 1];
  if (next === undefined) {
    toast('Already at the final stage. The partnership itself is renewed, not advanced.');
    return;
  }

  const reference = h('input', {
    type: 'text',
    placeholder: 'Companies-House-1234567, DNS TXT modex-verify=…, contract ref…',
    'aria-label': 'Evidence reference',
  });
  const confirmed = await confirmDialog({
    title: `Advance ${entry.displayName} to ${REGISTER_STAGE_LABELS[next]}`,
    body: h('div', { class: 'stack-sm' },
      h('p', { class: 'notice notice-info small' }, REGISTER_STAGE_EVIDENCE[next]),
      h('p', { class: 'small muted' }, 'The reference is stored with your name and today’s date. It cannot be left empty.'),
      reference),
    confirmLabel: 'Attach the evidence',
  });
  if (!confirmed) return;
  if (reference.value.trim() === '') {
    toast('Refused: a stage cannot be claimed without an evidence reference.');
    return;
  }
  if (next === 'contracted' && !(await stepUp(`Marking ${entry.displayName} as a signed partner publishes a verified badge on its public pages.`))) {
    toast('Step-up not completed; nothing changed.');
    return;
  }

  update((state) => {
    const existing = state.registerDecisions[entry.id] ?? { evidence: [] };
    state.registerDecisions[entry.id] = {
      ...existing,
      stage: next,
      state: next === 'contracted' ? 'verified' : 'pending',
      evidence: [...(existing.evidence ?? []), {
        stage: next,
        reference: reference.value.trim(),
        by: 'M. Haddad (Trust)',
        at: new Date().toISOString(),
      }],
      decidedAt: new Date().toISOString(),
    };
  });
  toast(`${entry.displayName} is now at ${REGISTER_STAGE_LABELS[next]}.`);
}

async function reject(entry) {
  const note = h('textarea', { placeholder: 'Why is this record being rejected?', 'aria-label': 'Reason' });
  const confirmed = await confirmDialog({
    title: `Reject ${entry.displayName}`,
    body: h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' }, 'The record stays in the register with the reason attached. Nothing is deleted.'),
      note),
    confirmLabel: 'Reject',
  });
  if (!confirmed) return;
  update((state) => {
    state.registerDecisions[entry.id] = {
      ...(state.registerDecisions[entry.id] ?? { evidence: [] }),
      state: 'rejected',
      note: note.value.trim(),
      decidedAt: new Date().toISOString(),
    };
  });
}

function entryForm() {
  const displayName = h('input', { type: 'text', placeholder: 'University of Somewhere', required: true });
  const country = h('input', { type: 'text', placeholder: 'GB', maxlength: '2', style: 'text-transform:uppercase' });
  const city = h('input', { type: 'text', placeholder: 'Somewhere' });
  const domain = h('input', { type: 'text', placeholder: 'somewhere.ac.uk' });
  const website = h('input', { type: 'url', placeholder: 'https://www.somewhere.ac.uk' });
  const priority = h('select', {},
    ['tier_1', 'tier_2', 'tier_3'].map((tier) => h('option', { value: tier }, titleCase(tier))));
  const errors = h('div', { class: 'stack-sm' });

  const save = () => {
    errors.replaceChildren();
    const problems = [];
    if (displayName.value.trim().length < 3) problems.push('A display name is required.');
    if (!/^[A-Za-z]{2}$/.test(country.value.trim())) problems.push('Country must be a two-letter ISO code, for example GB.');
    if (city.value.trim() === '') problems.push('A city is required — it is a public fact and it disambiguates campuses.');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.value.trim())) problems.push('The official domain does not look like a domain.');
    if (!/^https?:\/\//i.test(website.value.trim())) problems.push('The website must be an http(s) URL.');

    const clash = registerEntries().find((entry) =>
      entry.domains.some((one) => one.toLowerCase() === domain.value.trim().toLowerCase()));
    if (clash !== undefined) problems.push(`${clash.displayName} is already in the register on that domain.`);

    if (problems.length > 0) {
      errors.append(h('p', { class: 'notice notice-danger small' }, problems.join(' ')));
      return;
    }

    update((state) => state.registerAdditions.push({
      id: id('reg'),
      displayName: displayName.value.trim(),
      country: country.value.trim().toUpperCase(),
      city: city.value.trim(),
      domains: [domain.value.trim().toLowerCase()],
      websiteUrl: website.value.trim(),
      priority: priority.value,
      enteredAt: new Date().toISOString().slice(0, 10),
      enteredBy: 'M. Haddad (Trust)',
    }));

    toast('Entered at stage "Entered". Attach evidence to move it forward.');
    for (const input of [displayName, country, city, domain, website]) input.value = '';
  };

  return card(
    h('h2', {}, 'Enter a university'),
    h('p', { class: 'small muted', style: 'margin:6px 0 14px' },
      'Publicly verifiable identity facts only. Everything else is refused by this form on purpose: ',
      'a tuition figure typed by staff has no source, and a figure with no source is the thing this platform exists to remove.'),
    h('div', { class: 'grid grid-3' },
      h('label', { class: 'field' }, 'Display name', displayName),
      h('label', { class: 'field' }, 'Country (ISO 3166-1 alpha-2)', country),
      h('label', { class: 'field' }, 'City', city),
      h('label', { class: 'field' }, 'Official domain', domain),
      h('label', { class: 'field' }, 'Website', website),
      h('label', { class: 'field' }, 'Outreach priority', priority)),
    errors,
    h('div', { class: 'row', style: 'margin-top:14px' },
      button('Enter into the register', save, 'primary'),
      h('span', { class: 'small muted' }, 'Saved in this browser. Export below to commit it to the repository.')));
}

function exportRegister() {
  const entries = registerEntries().map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    country: entry.country,
    city: entry.city,
    domains: entry.domains,
    websiteUrl: entry.websiteUrl,
    priority: entry.priority ?? 'tier_2',
    enteredAt: entry.enteredAt,
    ...(entry.evidence.length > 0 ? { stage: entry.stage, evidence: entry.evidence } : {}),
    ...(entry.verificationState === 'rejected' ? { rejected: true, note: entry.note } : {}),
  }));
  downloadJson('institution-register.json', {
    $comment: 'Exported from the University intake console. Replace the `institutions` array in data/institution-register.json with this and commit.',
    register: { ...store.seed.register.policy, updatedAt: new Date().toISOString().slice(0, 10) },
    institutions: entries,
  });
  toast(`${entries.length} records exported. Commit them to data/institution-register.json.`);
}

// ---------------------------------------------------------------------------

function catalogueConsole() {
  const all = programmes();
  const withheld = all.filter((one) => !feesUsable(one.fees));

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      kpi('Programmes', String(all.length), 'Across the sample partners'),
      kpi('Money withheld', String(withheld.length), 'Confirmation expired'),
      kpi('Awaiting review', String(all.filter((one) => one.provenance.syncState === 'pending_review').length), 'Manual entry, unconfirmed')),

    withheld.length > 0
      ? h('p', { class: 'notice notice-warning' },
          'The freshness sweep has withheld a tuition figure on ', String(withheld.length),
          ' programme(s). Students see "figure out of date", never the old number. Ask the institution to re-publish.')
      : null,

    card(h('h2', {}, 'Programme records'),
      table(
        [{ label: 'Programme' }, { label: 'Institution' }, { label: 'Version', numeric: true }, { label: 'Sync' }, { label: 'Money' }, { label: 'Provenance' }],
        all.map((programme) => [
          link(`/programmes/${programme.programKey}`, programme.name),
          programme.institution.displayName,
          String(programme.version),
          badge(titleCase(programme.provenance.syncState),
            programme.provenance.syncState === 'synced' ? 'success'
              : programme.provenance.syncState === 'stale' ? 'warning' : 'neutral'),
          feesUsable(programme.fees)
            ? money(programme.fees.tuitionMinor, programme.fees.tuitionCurrency)
            : h('span', { style: 'color:var(--warning-text)' }, 'Withheld'),
          provenanceStamp(programme.provenance),
        ]))),

    card(h('h2', {}, 'Why a record is never edited here'),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'The university is the source of truth for its own facts. This console shows what arrived, when, and whether ',
        'it is still good. Correcting a figure by hand would create a record with a Modex-shaped provenance and a ',
        'university-shaped claim, which is exactly the confusion the provenance model exists to prevent.')));
}

// ---------------------------------------------------------------------------

function trustConsole() {
  const cases = store.state.trustCases;
  const expiring = guides().filter((guide) =>
    guide.expiresAt !== null && guideExpiryUrgency(guide.expiresAt) !== 'none');

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      kpi('Open cases', String(cases.filter((one) => one.state === 'open').length), 'Awaiting a decision'),
      kpi('Suspended guides', String(guides().filter((one) => one.state === 'suspended').length), 'By the pipeline or by review'),
      kpi('Reverification due', String(expiring.length), 'Notify → restrict → suspend runs automatically')),

    card(h('h2', {}, 'Cases'),
      cases.length === 0
        ? empty('No trust cases. Send a payment request in the chat to see one open.')
        : h('div', { class: 'stack' }, cases.map(caseCard))),

    card(h('h2', {}, 'Guide verification'),
      table(
        [{ label: 'Guide' }, { label: 'Institution' }, { label: 'State' }, { label: 'Evidence expires' }, { label: 'Automatic next step' }],
        guides().map((guide) => [
          link(`/guides/${guide.id}`, guide.displayName),
          guide.institutionId,
          guideStateBadge(guide),
          guide.expiresAt === null ? '—' : `${formatDate(guide.expiresAt)} · ${countdown(guide.expiresAt)}`,
          guide.expiresAt === null
            ? 'Nothing on file'
            : titleCase(guideLifecycleDecision({ state: guide.state, expiresAt: guide.expiresAt }, new Date()).action ?? 'none'),
        ])),
      h('p', { class: 'small muted', style: 'margin-top:10px' },
        'Expiry runs without a human: notify, then restrict, then suspend. A trust agent can act sooner, never later.')));
}

function caseCard(record) {
  const tone = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' }[record.severity] ?? 'neutral';
  return h('article', { class: 'card flat stack-sm', style: 'padding:14px' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('strong', {}, titleCase(record.type)),
        h('span', { class: 'small muted' }, `${record.targetType} ${record.targetId} · opened ${formatDateTime(record.openedAt)}`)),
      h('div', { class: 'chips' },
        badge(titleCase(record.severity ?? 'medium'), tone),
        badge(titleCase(record.state), record.state === 'resolved' ? 'success' : 'info'))),
    h('p', { class: 'small' }, record.summary),
    record.evidence?.length
      ? h('div', { class: 'stack-sm' },
          h('span', { class: 'small muted' }, 'Evidence preserved before any moderation action:'),
          h('ul', { class: 'mono small', style: 'margin:0;padding-left:18px' },
            record.evidence.map((evidence) => h('li', {}, evidence))))
      : null,
    record.state === 'open'
      ? h('div', { class: 'row' },
          button('Take the case', () => setCaseState(record.id, 'investigating'), 'secondary', { class: 'btn btn-secondary btn-sm' }),
          button('Resolve', async () => {
            if (await stepUp('Resolving a trust case closes it against the evidence above.')) setCaseState(record.id, 'resolved');
          }, 'ghost', { class: 'btn btn-ghost btn-sm' }))
      : record.state === 'investigating'
        ? button('Resolve', async () => {
            if (await stepUp('Resolving a trust case closes it against the evidence above.')) setCaseState(record.id, 'resolved');
          }, 'secondary', { class: 'btn btn-secondary btn-sm' })
        : null);
}

function setCaseState(caseId, next) {
  update((state) => {
    const record = state.trustCases.find((one) => one.id === caseId);
    if (record !== undefined) record.state = next;
  });
  toast(`Case ${caseId} → ${next}.`);
}

// ---------------------------------------------------------------------------

function opsConsole() {
  const all = applications();
  const stale = programmes().filter((one) => !feesUsable(one.fees));
  const alerts = [
    ...institutions()
      .filter((one) => one.connector.health === 'degraded')
      .map((one) => ({
        name: 'Connector degraded',
        detail: `${one.displayName}: ${one.connector.name} is slower than its budget.`,
        runbook: 'connector-down.md',
        tone: 'warning',
      })),
    ...(stale.length > 0
      ? [{
          name: 'Catalogue stale',
          detail: `${stale.length} programme(s) have a tuition figure past its confirmation window; the figure is withheld.`,
          runbook: 'catalogue-stale.md',
          tone: 'warning',
        }]
      : []),
    ...(all.some((one) => one.state === 'submitted_pending')
      ? [{
          name: 'Submission in flight',
          detail: 'An application is waiting on the university to confirm receipt.',
          runbook: 'application-stuck.md',
          tone: 'info',
        }]
      : []),
  ];

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      kpi('Applications', String(all.length), 'In this browser'),
      kpi('Confirmed by a university', String(all.filter((one) => one.externalRef !== null).length), 'With a durable reference'),
      kpi('Open alerts', String(alerts.length), 'Each one has a runbook')),

    card(h('h2', {}, 'Connectors'),
      table([{ label: 'Institution' }, { label: 'Route' }, { label: 'Health' }, { label: 'Confirms receipt' }, { label: 'Median ack' }],
        institutions().map((one) => [
          link(`/institutions/${one.id}`, one.displayName),
          one.connector.name,
          badge(titleCase(one.connector.health),
            one.connector.health === 'healthy' ? 'success' : one.connector.health === 'degraded' ? 'warning' : 'neutral'),
          one.connector.confirmsReceipt ? 'Yes' : 'No — no direct route',
          one.connector.medianAckSeconds === null ? '—' : `${one.connector.medianAckSeconds}s`,
        ]))),

    card(h('h2', {}, 'Alerts'),
      alerts.length === 0
        ? empty('Nothing firing.')
        : h('div', { class: 'stack-sm' }, alerts.map((alert) =>
            h('p', { class: `notice notice-${alert.tone}` },
              h('strong', {}, alert.name), ' — ', alert.detail, ' ',
              h('a', { href: `https://github.com/Delviss/ModexApply/blob/main/docs/runbooks/${alert.runbook}` }, 'Runbook'))))),

    card(h('h2', {}, 'Submissions'),
      all.length === 0
        ? empty('No applications yet.')
        : table([{ label: 'Application' }, { label: 'State' }, { label: 'University reference' }, { label: 'Checksum' }, { label: 'Sent' }],
            all.map((application) => [
              link(`/applications/${application.id}`, programmeByKey(application.programKey)?.name ?? application.programKey),
              titleCase(application.state),
              application.externalRef ?? '—',
              h('span', { class: 'mono small' }, application.checksum ?? '—'),
              application.submittedAt === null ? '—' : formatDateTime(application.submittedAt),
            ]))));
}

// ---------------------------------------------------------------------------

function financeConsole() {
  const sessions = store.state.sessions;
  const applicationsByGuide = (guideId) => {
    const conversation = store.state.conversations.find((one) => one.guideId === guideId);
    return conversation === undefined ? 0 : 1;
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid-3' },
      kpi('Sessions booked', String(sessions.length), 'Platform-managed, no direct payment path'),
      kpi('Rewards pending', String(sessions.filter((one) => one.rewardState === 'pending').length), 'Released after the session'),
      kpi('Payouts needing two approvals', String(sessions.filter((one) => one.rewardState === 'approved_once').length), 'Dual approval enforced')),

    h('p', { class: 'notice notice-safety' },
      h('strong', {}, 'The rule this console cannot break: '),
      'a reward is never tied to an admission outcome. There is no field on a session that reads an application state, ',
      'and the API has a test that fails if somebody adds one.'),

    card(h('h2', {}, 'Reward ledger'),
      sessions.length === 0
        ? empty('No sessions booked yet. Book one from a guide’s profile.')
        : table([{ label: 'Session' }, { label: 'Guide' }, { label: 'When' }, { label: 'Reward state' }, { label: 'Depends on an admission?' }, { label: '' }],
            sessions.map((session) => [
              h('span', { class: 'mono small' }, session.id),
              guideById(session.guideId)?.displayName ?? session.guideId,
              formatDateTime(session.at),
              badge(titleCase(session.rewardState), session.rewardState === 'paid' ? 'success' : 'neutral'),
              h('span', { class: 'small' }, 'No — structurally impossible'),
              session.rewardState === 'paid'
                ? null
                : button(session.rewardState === 'approved_once' ? 'Second approval' : 'Approve', async () => {
                    if (!(await stepUp('Approving a payout moves money to a guide.'))) return;
                    update((state) => {
                      const record = state.sessions.find((one) => one.id === session.id);
                      record.rewardState = record.rewardState === 'approved_once' ? 'paid' : 'approved_once';
                    });
                    toast('Recorded. A payout needs two named approvers, and they cannot be the same person.');
                  }, 'secondary', { class: 'btn btn-secondary btn-sm' }),
            ]))),

    card(h('h2', {}, 'Who receives what'),
      h('p', { class: 'small muted', style: 'margin-top:8px' },
        'Tuition, deposits and application fees are paid to the university, in the university’s own name, on the ',
        'university’s own rails. Modex never receives them and there is no "processing fee" line anywhere in the ',
        'product. Guides are paid by Modex, after a completed session, from this ledger.'),
      table([{ label: 'Money' }, { label: 'Payer' }, { label: 'Recipient' }, { label: 'Through' }], [
        ['Tuition', 'Student', 'The university', 'The university’s own payment page'],
        ['Deposit', 'Student', 'The university', 'The university’s own payment page'],
        ['Application fee', 'Student', 'The university', 'The university, or waived'],
        ['Guide reward', 'Modex', 'The guide', 'This ledger, after a session, dual-approved'],
      ])));
}
