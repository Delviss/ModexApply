import {
  h, link, badge, button, card, empty, table, money, formatDate, titleCase, toast,
} from '../ui.js';
import {
  programmes, programmeByKey, institutionById, institutions, eligibilityFor, feesUsable,
  offersFor, offerValueMinor, verifiedSavings, matchedGuides, store, update, applicationFor,
} from '../store.js';
import {
  programmeCard, feeLine, provenanceStamp, verificationBadge, sampleChip, verdictBadge,
  LEVEL_LABELS, MODE_LABELS, INTAKE_LABELS, INTAKE_TONES,
} from './components.js';

/**
 * Search.
 *
 * Filters are held in the URL, so a filtered result set is a link a student can
 * send to somebody — including to a guide, which is the point.
 */
export function catalogueView(route) {
  const query = route.query;
  const all = programmes();
  const results = filterProgrammes(all, query);

  const setParam = (key, value) => {
    const next = { ...query };
    if (value === '' || value === null) delete next[key];
    else next[key] = value;
    const search = new URLSearchParams(next).toString();
    location.hash = `#/programmes${search ? `?${search}` : ''}`;
  };

  return h('div', { class: 'wrap' },
    h('div', { class: 'stack', style: 'margin-bottom:20px' },
      h('h1', {}, 'Programmes'),
      h('p', { class: 'muted' },
        'Every figure below carries a provenance stamp. Where a university’s confirmation has expired, ',
        'the figure is withheld rather than shown.')),
    h('div', { class: 'split' },
      filterRail(all, query, setParam),
      h('div', { class: 'stack' },
        h('div', { class: 'row-between' },
          h('p', { class: 'muted small' },
            `${results.length} of ${all.length} programmes`,
            store.state.compare.length > 0 ? ' · ' : '',
            store.state.compare.length > 0
              ? link('/programmes/compare', `Compare ${store.state.compare.length} selected`)
              : null),
          h('div', { class: 'row' },
            h('label', { class: 'small muted', for: 'sort' }, 'Sort'),
            h('select', {
              id: 'sort',
              style: 'width:auto',
              onChange: (event) => setParam('sort', event.target.value),
              value: query.sort ?? 'relevance',
            },
              option('relevance', 'Best match', query.sort),
              option('tuition_asc', 'Tuition, lowest first', query.sort),
              option('deadline', 'Deadline, soonest first', query.sort)))),
        results.length === 0
          ? empty('No programme matches those filters.', button('Clear filters', () => { location.hash = '#/programmes'; }, 'secondary'))
          : results.map((programme) => programmeCard(programme, {
              verdict: eligibilityFor(programme).verdict,
              actions: h('div', { class: 'row' },
                link(`/programmes/${programme.programKey}`, 'Open programme', { class: 'btn btn-secondary btn-sm' }),
                compareToggle(programme)),
            })))));
}

function option(value, label, selected) {
  return h('option', { value, selected: selected === value }, label);
}

function compareToggle(programme) {
  const selected = store.state.compare.includes(programme.programKey);
  return button(selected ? 'Remove from compare' : 'Add to compare', () => {
    update((state) => {
      state.compare = selected
        ? state.compare.filter((key) => key !== programme.programKey)
        : [...state.compare, programme.programKey].slice(-4);
    });
  }, 'ghost', { class: 'btn btn-ghost btn-sm' });
}

function filterProgrammes(all, query) {
  const text = (query.q ?? '').toLowerCase().trim();
  let results = all.filter((programme) => {
    if (text !== '') {
      const haystack = [
        programme.name, programme.field, programme.description,
        programme.institution.displayName, programme.institution.city,
      ].join(' ').toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    if (query.country && programme.institution.country !== query.country) return false;
    if (query.level && programme.level !== query.level) return false;
    if (query.mode && programme.studyMode !== query.mode) return false;
    if (query.field && programme.field !== query.field) return false;
    if (query.maxTuition) {
      if (!feesUsable(programme.fees)) return false;
      if (programme.fees.tuitionMinor > Number(query.maxTuition) * 100) return false;
    }
    if (query.eligible === 'yes') {
      const verdict = eligibilityFor(programme).verdict;
      if (verdict !== 'eligible' && verdict !== 'likely_eligible') return false;
    }
    return true;
  });

  if (query.sort === 'tuition_asc') {
    results = [...results].sort((left, right) =>
      (feesUsable(left.fees) ? left.fees.tuitionMinor : Infinity) -
      (feesUsable(right.fees) ? right.fees.tuitionMinor : Infinity));
  } else if (query.sort === 'deadline') {
    const soonest = (programme) => Math.min(...programme.intakes.map((intake) => new Date(intake.applicationDeadline).getTime()));
    results = [...results].sort((left, right) => soonest(left) - soonest(right));
  }
  return results;
}

function filterRail(all, query, setParam) {
  const unique = (values) => [...new Set(values)].sort();
  const search = h('input', {
    type: 'search',
    value: query.q ?? '',
    placeholder: 'Subject, university, city',
    'aria-label': 'Search the catalogue',
    onChange: (event) => setParam('q', event.target.value.trim()),
  });

  return h('aside', { class: 'card stack', 'aria-label': 'Filters' },
    h('h2', { class: 'small' }, 'Filter'),
    search,
    select('Country', query.country, unique(all.map((one) => one.institution.country)), (value) => setParam('country', value)),
    select('Level', query.level, unique(all.map((one) => one.level)), (value) => setParam('level', value), LEVEL_LABELS),
    select('Subject area', query.field, unique(all.map((one) => one.field)), (value) => setParam('field', value)),
    select('Study mode', query.mode, unique(all.map((one) => one.studyMode)), (value) => setParam('mode', value), MODE_LABELS),
    h('label', { class: 'field' }, 'Maximum tuition per year',
      h('input', {
        type: 'number', min: '0', step: '500', value: query.maxTuition ?? '',
        placeholder: 'Any',
        onChange: (event) => setParam('maxTuition', event.target.value),
      })),
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: query.eligible === 'yes',
        onChange: (event) => setParam('eligible', event.target.checked ? 'yes' : ''),
      }),
      h('span', {}, 'Only programmes I appear to meet',
        h('span', { class: 'small muted' }, ' — judged against your profile, never a prediction of the decision'))),
    h('p', { class: 'small muted' },
      'Filters change the URL, so a result set is a link you can send to a guide.'));
}

function select(label, value, values, onChange, labels) {
  return h('label', { class: 'field' }, label,
    h('select', { onChange: (event) => onChange(event.target.value), value: value ?? '' },
      h('option', { value: '', selected: !value }, 'Any'),
      values.map((one) => h('option', { value: one, selected: value === one }, labels?.[one] ?? one))));
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export function compareView() {
  const selected = store.state.compare.map(programmeByKey).filter(Boolean);
  if (selected.length === 0) {
    return h('div', { class: 'wrap stack' },
      h('h1', {}, 'Compare programmes'),
      empty('Nothing selected yet.', link('/programmes', 'Search programmes', { class: 'btn btn-primary btn-sm' })));
  }

  const row = (label, render) => [label, ...selected.map(render)];
  const rows = [
    row('University', (one) => link(`/institutions/${one.institution.id}`, one.institution.displayName)),
    row('Verification', (one) => verificationBadge(one.institution)),
    row('Level', (one) => LEVEL_LABELS[one.level] ?? one.level),
    row('Duration', (one) => `${one.durationMonths} months`),
    row('Mode', (one) => MODE_LABELS[one.studyMode] ?? one.studyMode),
    row('Tuition per year', (one) => feesUsable(one.fees)
      ? money(one.fees.tuitionMinor, one.fees.tuitionCurrency)
      : h('span', { class: 'small', style: 'color:var(--warning-text)' }, 'Withheld — figure out of date')),
    row('Application fee', (one) => one.fees.applicationFeeMinor
      ? money(one.fees.applicationFeeMinor, one.fees.applicationFeeCurrency) : 'None'),
    row('Verified savings available', (one) => {
      const saving = verifiedSavings(one);
      return saving > 0 ? money(saving, one.fees.tuitionCurrency) : '—';
    }),
    row('Next deadline', (one) => formatDate(one.intakes.map((intake) => intake.applicationDeadline).sort()[0])),
    row('Requirements', (one) => String(one.requirements.length)),
    row('Your eligibility', (one) => verdictBadge(eligibilityFor(one).verdict)),
    row('Currency', (one) => one.fees.tuitionCurrency),
  ];

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Compare programmes'),
    h('p', { class: 'notice notice-info small' },
      'Tuition is compared in the currency each university publishes. Modex does not convert currencies here: ',
      'a converted figure is a figure nobody signed for, and the rate on the day you pay is not the rate today.'),
    table([{ label: '' }, ...selected.map((one) => ({ label: one.name }))], rows),
    h('div', { class: 'row' },
      link('/programmes', 'Back to search', { class: 'btn btn-secondary btn-sm' }),
      button('Clear comparison', () => update((state) => { state.compare = []; }), 'ghost', { class: 'btn btn-ghost btn-sm' })));
}

// ---------------------------------------------------------------------------
// Programme page
// ---------------------------------------------------------------------------

export function programmeView(programKey) {
  const programme = programmeByKey(programKey);
  if (programme === null) {
    return h('div', { class: 'wrap stack' }, h('h1', {}, 'Programme not found'), link('/programmes', 'Back to search'));
  }

  const { checks, verdict } = eligibilityFor(programme);
  const existing = applicationFor(programKey);
  const guideMatches = matchedGuides(programme.institution.id, {
    programKey: programme.programKey,
    campusId: programme.campusId,
    level: programme.level,
    discipline: programme.field,
  }).slice(0, 3);

  return h('div', { class: 'wrap stack' },
    h('nav', { class: 'small muted', 'aria-label': 'Breadcrumb' },
      link('/programmes', 'Programmes'), ' / ',
      link(`/institutions/${programme.institution.id}`, programme.institution.displayName), ' / ',
      programme.name),

    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h1', {}, programme.name),
        h('p', { class: 'muted' },
          `${LEVEL_LABELS[programme.level]} · ${programme.durationMonths} months · ${MODE_LABELS[programme.studyMode]} · `,
          programme.campus ? `${programme.campus.name}, ${programme.campus.city}` : programme.institution.city)),
      h('div', { class: 'chips' }, verificationBadge(programme.institution), sampleChip(),
        badge(`Version ${programme.version}`, 'neutral'))),

    programme.visibility === 'visible_with_warning'
      ? h('p', { class: 'notice notice-warning' },
          'This record is shown with a warning. ',
          programme.institution.verification.state === 'verified'
            ? 'It is out of sync with the university’s own source, so treat every figure as unconfirmed until it re-syncs.'
            : 'The university has not completed verification, so Modex has not confirmed anything on this page.')
      : null,

    h('div', { class: 'split wide' },
      h('div', { class: 'stack' },
        card(h('h2', {}, 'About this programme'),
          h('p', { class: 'muted', style: 'margin-top:8px' }, programme.description),
          h('div', { style: 'margin-top:12px' }, provenanceStamp(programme.provenance))),

        card(h('h2', {}, 'Requirements'),
          h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
            'Each requirement is a machine-readable rule plus the sentence the university published. ',
            'Anything Modex cannot read is marked unknown rather than guessed either way.'),
          table(
            [{ label: 'Requirement' }, { label: 'What the university says' }, { label: 'You' }, { label: 'Source' }],
            checks.map((check) => [
              titleCase(check.ruleType),
              h('div', { class: 'stack-sm' },
                h('span', {}, check.requirement),
                check.remedy ? h('span', { class: 'small muted' }, check.remedy) : null),
              h('div', { class: 'stack-sm' },
                outcomeBadge(check.outcome),
                check.studentValue ? h('span', { class: 'small muted' }, check.studentValue) : null),
              h('span', { class: 'mono small' }, check.sourceRef ?? '—'),
            ]))),

        card(h('h2', {}, 'Intakes'),
          table(
            [{ label: 'Starts' }, { label: 'Apply by' }, { label: 'Status' }, { label: 'Capacity', numeric: true }, { label: 'Provenance' }],
            programme.intakes.map((intake) => [
              formatDate(intake.startDate),
              formatDate(intake.applicationDeadline),
              badge(INTAKE_LABELS[intake.status], INTAKE_TONES[intake.status]),
              intake.capacity === null ? '—' : String(intake.capacity),
              provenanceStamp(intake.provenance),
            ]))),

        offersFor(programme).length > 0
          ? card(h('h2', {}, 'Scholarships, waivers and discounts'),
              h('div', { class: 'stack', style: 'margin-top:12px' },
                offersFor(programme).map((offer) => offerRow(offer, programme))))
          : null,

        guideMatches.length > 0
          ? card(h('h2', {}, 'Students who can answer questions about this'),
              h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
                'Ranked by the documented weights — university is a hard filter, trust score only breaks ties.'),
              h('div', { class: 'stack' }, guideMatches.map((match) =>
                h('div', { class: 'row-between' },
                  h('div', { class: 'stack-sm' },
                    h('strong', {}, link(`/guides/${match.profile.id}`, match.profile.displayName)),
                    h('span', { class: 'small muted' }, match.matchReason)),
                  link(`/messages?guide=${match.profile.id}`, 'Message', { class: 'btn btn-secondary btn-sm' })))))
          : null),

      h('aside', { class: 'stack' },
        card(feeLine(programme),
          h('div', { class: 'stack-sm', style: 'margin-top:14px' },
            verdictBadge(verdict),
            h('p', { class: 'small muted' },
              'This is a completeness check against what the university published. ',
              'It is never a prediction of the decision — only the university decides.')),
          h('div', { class: 'row', style: 'margin-top:14px' },
            existing === null
              ? link(`/apply/${programme.programKey}`, 'Start an application', { class: 'btn btn-primary' })
              : link(`/applications/${existing.id}`, 'Open your application', { class: 'btn btn-primary' }),
            compareToggle(programme))),

        card(h('h3', {}, 'How this application would be sent'),
          h('p', { class: 'small muted', style: 'margin-top:8px' },
            connectorSentence(programme.institution)),
          h('p', { class: 'small muted', style: 'margin-top:8px' },
            'A submission is successful only when the university confirms receipt and returns its own reference. ',
            'Generating a payload is not a submission.')),

        verifiedSavings(programme) > 0
          ? card(h('h3', {}, 'Verified savings'),
              h('p', { class: 'money', style: 'margin-top:8px' },
                money(verifiedSavings(programme), programme.fees.tuitionCurrency)),
              h('p', { class: 'small muted' }, 'Only offers with a named verifier and a live validity period are counted.'),
              link('/savings', 'See how this is worked out'))
          : null)));
}

function outcomeBadge(outcome) {
  const tones = { pass: 'success', fail: 'danger', unknown: 'neutral', missing_data: 'warning' };
  const labels = { pass: 'Met', fail: 'Not met', unknown: 'Unknown', missing_data: 'Needs your data' };
  return badge(labels[outcome], tones[outcome]);
}

function connectorSentence(institution) {
  const connector = institution.connector;
  if (connector.kind === 'direct_api') {
    return `Direct API route (${connector.name}). Median confirmation ${connector.medianAckSeconds} seconds; the university returns its own reference.`;
  }
  if (connector.kind === 'secure_handoff') {
    return `Secure handoff (${connector.name}). Your application is handed to the university's own portal, which confirms receipt — typically within ${Math.round((connector.medianAckSeconds ?? 0) / 60)} minutes.`;
  }
  return 'No direct route has been agreed with this university yet, so an application cannot be submitted through Modex.';
}

function offerRow(offer, programme) {
  const value = offerValueMinor(offer, programme);
  const verified = offer.verification.state === 'verified';
  return h('div', { class: `card flat ${verified ? '' : 'tinted'}`, style: 'padding:12px' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('strong', {}, offer.name),
        h('span', { class: 'small muted' }, offer.description)),
      h('div', { class: 'chips' },
        badge(verified ? 'Verified' : offer.verification.state === 'expiring' ? 'Re-confirmation due' : 'Unverified',
          verified ? 'success' : offer.verification.state === 'expiring' ? 'warning' : 'neutral'),
        value === null ? null : badge(money(value, offer.currency), 'brand'))),
    verified
      ? h('p', { class: 'small muted', style: 'margin-top:8px' },
          `Verified by ${offer.verification.verifierName} on ${formatDate(offer.verification.verifiedAt)}, valid until ${formatDate(offer.verification.expiresAt)}.`)
      : h('p', { class: 'small', style: 'margin-top:8px;color:var(--warning-text)' },
          offer.unverifiedNotice ?? 'Not confirmed by the university. It does not count toward any savings total.'));
}

// ---------------------------------------------------------------------------
// Institution page
// ---------------------------------------------------------------------------

export function institutionView(institutionId) {
  const institution = institutionById(institutionId);
  if (institution === null) {
    return h('div', { class: 'wrap stack' }, h('h1', {}, 'Institution not found'), link('/programmes', 'Back to search'));
  }
  const owned = programmes().filter((one) => one.institution.id === institution.id);
  const roster = matchedGuides(institution.id);

  return h('div', { class: 'wrap stack' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h1', {}, institution.displayName),
        h('p', { class: 'muted' },
          `${institution.city}, ${institution.country} · `,
          h('a', { href: institution.websiteUrl, rel: 'noopener noreferrer nofollow' }, institution.domains[0]))),
      h('div', { class: 'chips' }, verificationBadge(institution), sampleChip())),

    card(h('h2', {}, 'Verification'),
      h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
        institution.verification.evidenceSummary
          ?? 'This institution has not completed verification. Nothing on its pages is confirmed by Modex.'),
      h('div', { class: 'pipeline' },
        institution.pipeline.map((step) =>
          h('span', { class: `step ${step.status}` },
            h('span', { class: 'mark' }, step.status === 'done' ? '✓' : ''),
            titleCase(step.stage)))),
      institution.verification.verifiedAt
        ? h('p', { class: 'small muted', style: 'margin-top:12px' },
            `Verified by ${institution.verification.verifierName} on ${formatDate(institution.verification.verifiedAt)}. `,
            `This claim expires on ${formatDate(institution.verification.expiresAt)} and must be renewed.`)
        : null),

    h('div', { class: 'grid grid-2' },
      card(h('h3', {}, 'Partnership'),
        h('p', { class: 'small muted', style: 'margin:8px 0' },
          `Status: ${titleCase(institution.partnership.status)}`),
        h('div', { class: 'chips' },
          institution.partnership.scopes.map((scope) => h('span', { class: 'chip selected' }, titleCase(scope)))),
        h('p', { class: 'small muted', style: 'margin-top:10px' },
          institution.partnership.startDate
            ? `In force ${formatDate(institution.partnership.startDate)} — ${formatDate(institution.partnership.endDate)}.`
            : 'No signed partnership yet, so no direct application route.')),
      card(h('h3', {}, 'Application route'),
        h('p', { class: 'small muted', style: 'margin:8px 0' }, connectorSentence(institution)),
        badge(titleCase(institution.connector.health), institution.connector.health === 'healthy' ? 'success'
          : institution.connector.health === 'degraded' ? 'warning' : 'neutral'))),

    card(h('h2', {}, 'Campuses'),
      table([{ label: 'Campus' }, { label: 'City' }, { label: 'Country' }],
        institution.campuses.map((campus) => [campus.name, campus.city, campus.country]))),

    h('section', { class: 'stack' },
      h('h2', {}, `Programmes (${owned.length})`),
      owned.map((programme) => programmeCard(programme, {
        verdict: eligibilityFor(programme).verdict,
        actions: link(`/programmes/${programme.programKey}`, 'Open programme', { class: 'btn btn-secondary btn-sm' }),
      }))),

    roster.length > 0
      ? h('section', { class: 'stack' },
          h('h2', {}, 'Verified student guides here'),
          h('div', { class: 'grid grid-2' },
            roster.map((match) => h('article', { class: 'card stack-sm' },
              h('h3', {}, link(`/guides/${match.profile.id}`, match.profile.displayName)),
              h('p', { class: 'small muted' }, match.profile.programName),
              h('p', { class: 'small muted' }, match.matchReason)))))
      : null);
}
