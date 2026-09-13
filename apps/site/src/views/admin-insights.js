import { h, badge, card, empty, table, money } from '../ui.js';
import {
  store, applications, programmes, institutions, guides, registerEntries, feesUsable, programmeByKey,
} from '../store.js';
import {
  ASSESSMENT_SLA_HOURS, MIN_COHORT, biggestDropOff, buildFunnel, buildInsightNotes, dailyTrend,
  distribution, formatHours, formatRate, hoursBetween, median, percentile, totalsByCurrency,
  trendChange,
} from '../engine.js';
import { bar } from './admin-shell.js';
import { documentQueue, documentSummary } from './admin-documents.js';

/**
 * Statistics and insights (Phase 8).
 *
 * Nothing on this page is calculated here. Every figure comes from the pure
 * functions in `@modex/contracts/insights`, which the API's `/admin/insights`
 * endpoint also calls — so this console and the platform report the same
 * platform, and a threshold changed in one place changes in both.
 *
 * The three product boundaries the shared module holds, restated because they
 * are the reason this page looks plainer than a dashboard usually does:
 *
 * **No figure here predicts an admission.** The funnel says what happened to a
 * cohort. There is no number anywhere that divides offers by applications and
 * presents the result to a student, or to staff, as a chance of getting in.
 *
 * **A rate over a small cohort is withheld, not rounded.** Below `MIN_COHORT`
 * observations the value is `null` and the reason is printed instead. A
 * conversion rate over four applications is noise with a decimal point.
 *
 * **Money is totalled per currency and never across them.**
 */
export function insightsConsole(query) {
  const windowDays = ['7', '30', '90'].includes(query.window) ? Number(query.window) : 30;
  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const all = applications();
  const inWindow = all.filter((one) => new Date(one.createdAt) >= since);
  const funnel = buildFunnel(inWindow.map((one) => one.state));
  const started = funnel.find((row) => row.stage === 'started')?.count ?? 0;
  const drop = biggestDropOff(funnel);

  const documentRows = documentQueue(now);
  const documents = documentSummary(documentRows);
  const reviewHours = documentRows
    .filter((row) => row.assessment?.decidedAt != null)
    .map((row) => hoursBetween(row.version.createdAt, row.assessment.decidedAt));

  const ackHours = inWindow
    .filter((one) => one.submittedAt !== null && one.externalRef !== null)
    .map((one) => hoursBetween(one.createdAt, one.submittedAt));

  const stale = programmes().filter((one) => !feesUsable(one.fees));
  const register = registerEntries();
  const unverified = register.filter((one) => one.verificationState !== 'verified').length;
  const openCases = store.state.trustCases.filter((one) => one.state === 'open').length;

  const trend = dailyTrend(inWindow.map((one) => one.createdAt), Math.min(windowDays, 90), now);
  const change = trendChange(trend);

  const notes = buildInsightNotes({
    funnel,
    overdueAssessments: documents.overdue,
    quarantined: documents.quarantined,
    staleMoneyRecords: stale.length,
    openTrustCases: openCases,
    unverifiedRegisterEntries: unverified,
    medianReviewHours: median(reviewHours),
    slaHours: ASSESSMENT_SLA_HOURS,
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'row-between' },
      h('p', { class: 'small muted', style: 'margin:0' },
        'Computed in this browser from this browser’s data, by the same functions the API reports '
        + 'from. Nothing is fetched and nothing is sent.'),
      h('nav', { class: 'chips', 'aria-label': 'Reporting window' },
        [7, 30, 90].map((days) =>
          h('a', {
            href: `#/admin/insights?window=${days}`,
            class: `chip ${days === windowDays ? 'selected' : ''}`,
          }, `${days} days`)))),

    h('div', { class: 'stack-sm' },
      notes.map((note) =>
        h('p', { class: `notice notice-${note.tone === 'neutral' ? 'info' : note.tone}` },
          note.action ? h('strong', {}, `${note.action} — `) : null, note.text))),

    card(
      h('h2', {}, 'Where applications get to'),
      h('p', { class: 'small muted', style: 'margin:6px 0 14px' },
        'Cumulative: an application with an offer also counts as submitted. A payload that left '
        + 'the building but that no university has confirmed receiving is ',
        h('strong', {}, 'not'), ' counted as having reached one — that is what ',
        h('span', { class: 'mono' }, 'submitted_pending'), ' exists to say.'),
      h('ul', { class: 'dash-funnel' },
        funnel.map((row) =>
          h('li', {},
            h('div', { class: 'row-between' },
              h('span', { class: 'small' }, row.label),
              h('span', { class: 'small' },
                String(row.count),
                row.ofStarted.value === null ? '' : ` · ${formatRate(row.ofStarted)}`)),
            bar(started === 0 ? 0 : row.count / started)))),
      drop === null
        ? h('p', { class: 'small muted', style: 'margin-top:10px' },
            `Too few applications in this window to name where they stop — a drop-off computed over `
            + `fewer than ${MIN_COHORT} is a description of one person’s afternoon.`)
        : h('p', { class: 'small muted', style: 'margin-top:10px' },
            `The largest gap is between "${drop.from.label}" and "${drop.to.label}": `
            + `${drop.lost} application(s).`)),

    h('div', { class: 'grid grid-2' },
      card(
        h('h3', {}, 'How long things take'),
        table([{ label: 'Measure' }, { label: 'Median' }, { label: 'Slowest tenth' }], [
          ['Start to submission', formatHours(median(ackHours)), formatHours(percentile(ackHours, 0.9))],
          ['Upload to a document decision', formatHours(median(reviewHours)), formatHours(percentile(reviewHours, 0.9))],
        ]),
        h('p', { class: 'small muted', style: 'margin-top:10px' },
          'The median, never the mean. One application that sat over a holiday moves a mean by days '
          + 'and a median by nothing, and this number is read as "how long does this normally take".')),

      card(
        h('h3', {}, 'Document assessment'),
        h('div', { class: 'chips' },
          badge(`${documents.awaitingReview} waiting for a reviewer`, 'info'),
          badge(`${documents.decided} decided`, 'success'),
          badge(`${documents.overdue} past the commitment`, documents.overdue > 0 ? 'warning' : 'neutral'),
          badge(`${documents.quarantined} quarantined`, documents.quarantined > 0 ? 'danger' : 'neutral')),
        h('p', { class: 'small muted', style: 'margin-top:10px' },
          `Students are told we look at documents within ${ASSESSMENT_SLA_HOURS} hours. That number `
          + 'is one constant, quoted to them and measured here, so the two cannot drift apart.'))),

    h('div', { class: 'grid grid-2' },
      sliceCard('Applications by institution',
        distribution(inWindow.map((one) => programmeByKey(one.programKey)?.institution?.id ?? 'unknown'), {
          labels: Object.fromEntries(institutions().map((one) => [one.id, one.displayName])),
          limit: 6,
        })),
      sliceCard('Applications by programme',
        distribution(inWindow.map((one) => one.programKey), {
          labels: Object.fromEntries(programmes().map((one) => [one.programKey, one.name])),
          limit: 6,
        }))),

    card(
      h('h3', {}, 'Applications started, by day'),
      trend.every((point) => point.count === 0)
        ? empty('No applications started in this window.')
        : h('div', { class: 'dash-spark' },
            trend.map((point) =>
              h('div', {
                class: 'dash-spark-col',
                title: `${point.date}: ${point.count}`,
                style: `height:${point.count === 0 ? 2 : Math.min(100, point.count * 28)}%`,
              }))),
      h('p', { class: 'small muted', style: 'margin-top:10px' },
        change === null
          ? 'Too short a series to call a trend. "Up 100%" from a base of zero is a first event, not a trend.'
          : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change * 100).toFixed(0)}% on the first half of the window.`),
      h('p', { class: 'small muted' },
        'Empty days are drawn as empty. A sparse series joined into a line interpolates across the '
        + 'gap, which turns a weekend with no applications into a gentle slope.')),

    card(
      h('h3', {}, 'Published offer value'),
      offerTotals(),
      h('p', { class: 'small muted', style: 'margin-top:10px' },
        'Per currency, with no combined figure anywhere. Adding pounds to euros produces a number '
        + 'that means nothing and looks authoritative.')),

    card(
      h('h3', {}, 'The network'),
      table([{ label: 'Thing' }, { label: 'Count', numeric: true }, { label: 'Note' }], [
        ['Universities in the register', String(register.length), `${unverified} below "Partnership signed"`],
        ['Programmes in the catalogue', String(programmes().length), `${stale.length} with money withheld`],
        ['Active student guides', String(guides().filter((one) => one.state === 'active').length), 'Evidence on file and unexpired'],
        ['Open trust cases', String(openCases), 'Anti-scam pipeline and reports'],
      ])));
}

function sliceCard(title, slices) {
  return card(
    h('h3', {}, title),
    slices.length === 0
      ? empty('Nothing in this window.')
      : h('ul', { class: 'dash-funnel' },
          slices.map((slice) =>
            h('li', {},
              h('div', { class: 'row-between' },
                h('span', { class: 'small' }, slice.label),
                h('span', { class: 'small' }, `${slice.count} · ${(slice.share * 100).toFixed(0)}%`)),
              bar(slice.share)))));
}

function offerTotals() {
  // Only cash awards. A percentage discount has no amount until it is applied
  // to a specific tuition figure, and a "total value" that quietly assumes one
  // is the kind of number this product exists to remove.
  const published = store.seed.offers.filter((one) => one.valueMinor != null);
  const totals = totalsByCurrency(published.map((one) => ({
    amountMinor: one.valueMinor,
    currency: one.currency ?? 'GBP',
  })));

  return totals.length === 0
    ? empty('No published offer carries a cash value.')
    : table([{ label: 'Currency' }, { label: 'Total', numeric: true }, { label: 'Offers', numeric: true }],
        totals.map((total) => [
          total.currency,
          money(total.amountMinor, total.currency),
          String(total.count),
        ]));
}
