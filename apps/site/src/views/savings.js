import { h, link, badge, card, table, money, formatDate, titleCase, button } from '../ui.js';
import { offers, programmes, programmeByKey, offerValueMinor, verifiedSavings, feesUsable, institutionById } from '../store.js';
import { sampleChip } from './components.js';

/**
 * Savings.
 *
 * The organising rule: an unverified claim never contributes to a total, and is
 * never hidden either. A student who has heard about a scholarship needs to see
 * that Modex could not confirm it — deleting it teaches them nothing and sends
 * them back to whoever advertised it.
 */
export function savingsView() {
  const all = offers();
  const verified = all.filter((one) => one.verification.state === 'verified');
  const unverified = all.filter((one) => one.verification.state !== 'verified');

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Scholarships, waivers and discounts'),
    h('p', { class: 'muted' },
      'Every entry names who verified it and when that verification runs out. Nothing here is a discount coupon: ',
      'these are the university’s own published terms, or a claim we could not confirm, clearly marked as such.'),

    h('section', { class: 'stack' },
      h('h2', {}, `Verified (${verified.length})`),
      h('div', { class: 'grid grid-2' }, verified.map(offerCard))),

    h('section', { class: 'stack' },
      h('h2', {}, `Unverified claims (${unverified.length})`),
      h('p', { class: 'notice notice-warning small' },
        'Shown because students ask about them, not because they are confirmed. They count for nothing in the ',
        'totals below, and no money should ever be sent to anyone in connection with them.'),
      h('div', { class: 'grid grid-2' }, unverified.map(offerCard))),

    h('section', { class: 'stack' },
      h('h2', {}, 'What this is worth, per programme'),
      table(
        [{ label: 'Programme' }, { label: 'Tuition', numeric: true }, { label: 'Verified savings', numeric: true },
          { label: 'Net, if every condition is met', numeric: true }, { label: 'Applied' }],
        programmes()
          .map((programme) => {
            const saving = verifiedSavings(programme);
            const usable = feesUsable(programme.fees);
            return [
              link(`/programmes/${programme.programKey}`, programme.name),
              usable ? money(programme.fees.tuitionMinor, programme.fees.tuitionCurrency) : 'Withheld',
              saving > 0 ? money(saving, programme.fees.tuitionCurrency) : '—',
              usable && saving > 0
                ? money(programme.fees.tuitionMinor - saving, programme.fees.tuitionCurrency)
                : '—',
              h('span', { class: 'small muted' },
                verifiedNames(programme).join(', ') || 'None'),
            ];
          })),
      h('p', { class: 'small muted' },
        'A net figure assumes every condition is met and every verification still stands on the day you are billed. ',
        'It is an estimate of published terms, never a promise, and Modex does not collect any of it.')));
}

function verifiedNames(programme) {
  return offers()
    .filter((offer) => offer.institutionId === programme.institution?.id
      && offer.verification.state === 'verified'
      && (offer.programKeys.length === 0 || offer.programKeys.includes(programme.programKey)))
    .map((offer) => offer.name);
}

function offerCard(offer) {
  const institution = offer.institutionId === null ? null : institutionById(offer.institutionId);
  const verified = offer.verification.state === 'verified';
  const sample = offer.programKeys[0] ? programmeByKey(offer.programKeys[0]) : null;
  const value = sample === null ? null : offerValueMinor(offer, sample);

  return h('article', { class: `card stack-sm ${verified ? '' : 'tinted'}` },
    h('div', { class: 'row-between' },
      h('h3', {}, offer.name),
      h('div', { class: 'chips' },
        badge(titleCase(offer.kind), 'neutral'),
        badge(verified ? 'Verified'
          : offer.verification.state === 'expiring' ? 'Re-confirmation due' : 'Unverified',
          verified ? 'success' : offer.verification.state === 'expiring' ? 'warning' : 'neutral'))),
    h('p', { class: 'small muted' }, offer.description),
    institution ? h('p', { class: 'small' }, link(`/institutions/${institution.id}`, institution.displayName), ' ', sampleChip()) : null,
    value === null
      ? null
      : h('p', { class: 'money' },
          offer.valueKind === 'percentage_of_tuition'
            ? `${offer.valuePercent}%`
            : money(offer.valueMinor, offer.currency),
          h('span', { class: 'small muted', style: 'font-weight:500' },
            offer.valueKind === 'percentage_of_tuition' ? ' of tuition' : '')),
    offer.conditions.length > 0
      ? h('ul', { class: 'small muted', style: 'margin:0;padding-left:18px' },
          offer.conditions.map((condition) => h('li', {}, condition)))
      : null,
    verified
      ? h('p', { class: 'small muted' },
          `Verified by ${offer.verification.verifierName} on ${formatDate(offer.verification.verifiedAt)}. `,
          `Valid until ${formatDate(offer.verification.expiresAt)}.`)
      : h('p', { class: 'small', style: 'color:var(--warning-text)' },
          offer.unverifiedNotice ?? 'Modex has not been able to confirm this with the university.'),
    offer.deadline ? h('p', { class: 'small muted' }, `Apply by ${formatDate(offer.deadline)}.`) : null);
}
