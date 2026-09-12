import { h, badge, link, formatDate, money, titleCase, countdown } from '../ui.js';
import { feesUsable, VERDICT_LABELS, VERDICT_TONES } from '../store.js';
import { GUIDE_TOPIC_LABELS, guideExpiryUrgency, daysUntil } from '../engine.js';

export const LEVEL_LABELS = {
  foundation: 'Foundation',
  undergraduate: 'Undergraduate',
  postgraduate_taught: 'Postgraduate (taught)',
  postgraduate_research: 'Postgraduate (research)',
  doctorate: 'Doctorate',
  pathway: 'Pathway',
  short_course: 'Short course',
};

export const MODE_LABELS = {
  full_time: 'Full time',
  part_time: 'Part time',
  distance: 'Distance',
  hybrid: 'Hybrid',
};

export const INTAKE_LABELS = {
  scheduled: 'Scheduled',
  open: 'Open',
  closing_soon: 'Closing soon',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** `closing_soon` is a warning, never a brand moment: urgency is not a sales tool. */
export const INTAKE_TONES = {
  scheduled: 'neutral',
  open: 'success',
  closing_soon: 'warning',
  closed: 'neutral',
  cancelled: 'danger',
};

/**
 * The provenance stamp.
 *
 * Every fee, deadline and requirement on the platform carries one: where the
 * record came from, when the institution last changed it, when Modex last
 * confirmed it and when that confirmation runs out.
 */
export function provenanceStamp(provenance) {
  const stale = provenance.syncState === 'stale' || provenance.syncState === 'failed';
  const unconfirmed = provenance.verifiedAt === null;
  const tone = stale ? 'stale' : unconfirmed ? 'unconfirmed' : '';

  return h('p', { class: `provenance ${tone}` },
    h('span', { class: 'dot-mark' }),
    h('span', {}, unconfirmed
      ? 'Not yet confirmed by Modex'
      : `Confirmed ${formatDate(provenance.verifiedAt)}`),
    provenance.sourceUpdatedAt ? h('span', {}, `· university updated ${formatDate(provenance.sourceUpdatedAt)}`) : null,
    provenance.expiresAt ? h('span', {}, `· expires ${formatDate(provenance.expiresAt)}`) : null,
    provenance.sourceRef ? h('span', { class: 'mono' }, provenance.sourceRef) : null,
    provenance.reviewedBy ? h('span', {}, `· signed off by ${provenance.reviewedBy}`) : null);
}

export function verificationBadge(institution) {
  const state = institution.verification.state;
  if (state === 'verified') {
    return badge('Verified university', 'success',
      institution.verification.evidenceSummary ?? 'Verified by Modex Trust.');
  }
  if (state === 'pending') return badge('Verification in progress', 'warning');
  return badge('Not verified', 'neutral');
}

export const sampleChip = () =>
  badge('Sample data', 'sample', 'Fictional institution and figures, used so the journey can be walked end to end.');

/** Money, or an honest absence. A wrong price is worse than an absent one. */
export function feeLine(programme, now = new Date()) {
  const fees = programme.fees;
  if (!feesUsable(fees, now)) {
    return h('div', { class: 'stack-sm' },
      h('p', { class: 'money-withheld' }, 'Tuition withheld — the university’s figure is out of date'),
      h('p', { class: 'small muted' },
        'The last confirmed figure expired on ', formatDate(fees.provenance.expiresAt),
        '. We would rather show you nothing than a price that has changed. Ask the university, or a guide who is paying it.'));
  }
  return h('div', { class: 'stack-sm' },
    h('p', { class: 'money' }, money(fees.tuitionMinor, fees.tuitionCurrency),
      h('span', { class: 'small muted', style: 'font-weight:500' }, ' tuition, per year')),
    h('p', { class: 'small muted' },
      fees.applicationFeeMinor
        ? `Application fee ${money(fees.applicationFeeMinor, fees.applicationFeeCurrency)}`
        : 'No application fee',
      fees.depositMinor ? ` · deposit ${money(fees.depositMinor, fees.depositCurrency)}` : ''),
    provenanceStamp(fees.provenance));
}

export function verdictBadge(verdict) {
  return badge(VERDICT_LABELS[verdict], VERDICT_TONES[verdict]);
}

export function programmeCard(programme, options = {}) {
  const institution = programme.institution;
  return h('article', { class: 'card result' },
    h('div', { class: 'headline' },
      h('div', { class: 'stack-sm' },
        h('h3', {}, link(`/programmes/${programme.programKey}`, programme.name)),
        h('p', { class: 'small muted' },
          link(`/institutions/${institution.id}`, institution.displayName), ' · ',
          programme.campus ? `${programme.campus.name}, ` : '',
          `${programme.campus?.city ?? institution.city}, ${institution.country}`)),
      h('div', { class: 'chips' }, verificationBadge(institution), sampleChip())),
    h('div', { class: 'facts' },
      h('span', {}, h('b', {}, LEVEL_LABELS[programme.level] ?? programme.level)),
      h('span', {}, h('b', {}, programme.field)),
      h('span', {}, `${programme.durationMonths} months`),
      h('span', {}, MODE_LABELS[programme.studyMode] ?? programme.studyMode)),
    programme.visibility === 'visible_with_warning'
      ? h('p', { class: 'notice notice-warning small' },
          'Shown with a warning: ',
          institution.verification.state === 'verified'
            ? 'this record is not currently in sync with the university’s source.'
            : 'this university has not finished verification, so nothing here is confirmed by Modex yet.')
      : null,
    feeLine(programme),
    options.verdict ? h('div', { class: 'row' }, verdictBadge(options.verdict)) : null,
    h('div', { class: 'row' },
      programme.intakes.slice(0, 3).map((intake) =>
        badge(`${formatDate(intake.startDate)} · apply by ${formatDate(intake.applicationDeadline)}`,
          INTAKE_TONES[intake.status]))),
    options.actions ?? null);
}

/** Permanent in every conversation surface. Not a dismissible toast (Phase 3). */
export function safetyBanner() {
  return h('p', { class: 'notice notice-safety' },
    h('strong', {}, 'Guides never collect tuition or application fees, and cannot guarantee admission or a visa. '),
    'Report anything that sounds like a payment request. Keep the conversation on Modex — off-platform messages cannot be reviewed.');
}

export function guideStateBadge(guide, now = new Date()) {
  if (guide.state === 'suspended' || guide.state === 'revoked') return badge(titleCase(guide.state), 'danger');
  if (guide.state === 'restricted') return badge('Restricted', 'warning');
  if (guide.state === 'pending') return badge('Verification pending', 'neutral');
  const urgency = guide.expiresAt ? guideExpiryUrgency(guide.expiresAt, now) : 'none';
  if (urgency === 'urgent') return badge(`Reverification due ${countdown(guide.expiresAt, now)}`, 'danger');
  if (urgency === 'due') return badge(`Expiring soon · ${daysUntil(guide.expiresAt, now)} days`, 'warning');
  return badge('Verified current student', 'success',
    `Evidence confirmed ${formatDate(guide.verifiedAt)}, valid until ${formatDate(guide.expiresAt)}.`);
}

export function topicChips(topics) {
  return h('div', { class: 'chips' },
    topics.map((topic) => h('span', { class: 'chip' }, GUIDE_TOPIC_LABELS[topic] ?? titleCase(topic))));
}
