import {
  h, badge, button, card, empty, table, formatDateTime, titleCase, toast, confirmDialog,
} from '../ui.js';
import {
  store, update, asDocumentVersion, assessmentFor, versionKey, openForReview, decideDocument,
} from '../store.js';
import {
  ASSESSMENT_REASONS, ASSESSMENT_REASON_TEXT, ASSESSMENT_SLA_HOURS,
  assessmentBlockReason, assessmentState, canAssess, escalatesToTrust, isOverdue,
} from '../engine.js';

/**
 * The document assessment console (Phase 8).
 *
 * The queue a reviewer works, and every rule it enforces is imported rather
 * than restated: `canAssess` decides whether the Open control exists,
 * `assessmentState` decides the badge, `ASSESSMENT_REASON_TEXT` writes the
 * sentence the student receives. Those are the same objects the API's review
 * endpoint enforces, so this console cannot offer a decision the platform would
 * refuse — which is the only way a demo of a review queue is worth anything.
 *
 * Two behaviours are worth reading before changing them.
 *
 * **Nothing is shown until somebody opens it.** The queue lists a type, a size,
 * a checksum and an age. It does not preview the file. A queue that renders
 * everybody's passport has disclosed them all to whoever walked past the desk,
 * and no audit trail afterwards undoes that.
 *
 * **Opening is recorded.** The access log at the bottom of this page is the
 * visible half of what the API writes to `audit_events`; it is on the page
 * rather than hidden precisely because a reviewer should see that their reads
 * are attributable.
 */

const DOCUMENT_TYPE_LABELS = {
  passport: 'Passport',
  transcript: 'Academic transcript',
  degree_certificate: 'Degree certificate',
  language_test: 'Language test result',
  personal_statement: 'Personal statement',
  reference_letter: 'Reference letter',
  cv: 'CV',
  financial_evidence: 'Financial evidence',
  portfolio: 'Portfolio',
  other: 'Other',
};

const STATE_LABELS = {
  awaiting_scan: 'Waiting on the scan',
  awaiting_review: 'Waiting for a reviewer',
  in_review: 'Open with a reviewer',
  accepted: 'Accepted',
  more_information: 'More information needed',
  rejected: 'Not accepted',
};

const STATE_TONES = {
  awaiting_scan: 'neutral',
  awaiting_review: 'info',
  in_review: 'info',
  accepted: 'success',
  more_information: 'warning',
  rejected: 'danger',
};

/** One row per document version, with its decision joined on. */
export function documentQueue(now = new Date()) {
  return store.state.documents.map((document) => {
    const version = asDocumentVersion(document);
    const assessment = assessmentFor(document);
    return {
      document,
      version,
      assessment,
      state: assessmentState(version, assessment === null ? null : {
        decision: assessment.decision ?? null,
        startedAt: assessment.openedAt ?? null,
      }),
      openable: canAssess(version),
      blockReason: assessmentBlockReason(version),
      overdue: isOverdue({
        createdAt: version.createdAt,
        decidedAt: assessment?.decidedAt ?? null,
      }, now),
    };
  });
}

/** The counts the rail and the KPI strip both read. */
export function documentSummary(rows = documentQueue()) {
  return {
    awaitingReview: rows.filter((row) => row.state === 'awaiting_review' || row.state === 'in_review').length,
    awaitingScan: rows.filter((row) => row.state === 'awaiting_scan').length,
    decided: rows.filter((row) => row.assessment?.decidedAt != null).length,
    overdue: rows.filter((row) => row.overdue).length,
    quarantined: rows.filter((row) => row.version.scanState === 'quarantined').length,
    slaHours: ASSESSMENT_SLA_HOURS,
  };
}

export function documentsConsole(query) {
  const rows = documentQueue();
  const filter = query.state ?? '';
  const shown = filter === '' ? rows : rows.filter((row) => row.state === filter);
  const summary = documentSummary(rows);

  return h('div', { class: 'stack' },
    summary.quarantined > 0
      ? h('p', { class: 'notice notice-danger' },
          h('strong', {}, `${summary.quarantined} upload(s) are quarantined. `),
          'Nobody opens these. The student is asked for a clean copy, and the version stays blocked '
          + 'permanently — there is no path back to "clean" for the same bytes.')
      : null,

    card(
      h('div', { class: 'card-head' },
        h('h2', {}, `Documents (${shown.length})`),
        h('select', {
          'aria-label': 'Filter by state', style: 'width:auto',
          onChange: (event) => {
            location.hash = event.target.value === ''
              ? '#/admin/documents'
              : `#/admin/documents?state=${event.target.value}`;
          },
        },
          h('option', { value: '', selected: filter === '' }, 'All states'),
          Object.entries(STATE_LABELS).map(([value, label]) =>
            h('option', { value, selected: filter === value }, label)))),

      h('p', { class: 'small muted', style: 'margin-bottom:12px' },
        'The list shows a type, a size, a checksum and an age — never the file. Opening one is a '
        + 'separate action, and it is recorded against your name. Students are told we look at '
        + `documents within ${ASSESSMENT_SLA_HOURS} hours; anything past that is marked here.`),

      shown.length === 0
        ? empty('Nothing in this state.')
        : h('div', { class: 'stack' }, shown.map(reviewCard))),

    accessLog());
}

function reviewCard(row) {
  const { document, version, assessment, state } = row;

  return h('article', { class: 'card flat stack-sm', style: 'padding:14px' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('strong', {}, DOCUMENT_TYPE_LABELS[document.type] ?? document.type),
        h('span', { class: 'small muted' },
          `${document.displayName} · version ${document.version} · ${document.sizeKb} kB · uploaded ${formatDateTime(version.createdAt)}`),
        h('span', { class: 'mono small' }, document.checksum ?? '—')),
      h('div', { class: 'chips' },
        badge(STATE_LABELS[state] ?? state, STATE_TONES[state] ?? 'neutral'),
        row.overdue ? badge('Past the review commitment', 'warning') : null)),

    row.blockReason !== null
      ? h('p', { class: 'notice notice-warning small' }, row.blockReason)
      : null,

    assessment?.decidedAt != null
      ? decidedBlock(assessment)
      : row.openable
        ? (assessment?.openedAt != null
            ? decisionForm(row)
            : h('div', { class: 'stack-sm' },
                h('div', { class: 'row' },
                  button('Open this document', () => {
                    openForReview(document);
                    toast('Opened. That is recorded against your name in the access log below.');
                  }, 'secondary', { class: 'btn btn-secondary btn-sm' })),
                h('p', { class: 'small muted' },
                  'Decide from the document, not from its file name.')))
        : null);
}

function decidedBlock(assessment) {
  const tone = assessment.decision === 'accepted' ? 'success'
    : assessment.decision === 'rejected' ? 'danger' : 'warning';
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'row' },
      badge(titleCase(assessment.decision), tone),
      h('span', { class: 'small muted' },
        `${assessment.reviewerId ?? 'A reviewer'} · ${formatDateTime(assessment.decidedAt)}`)),
    h('ul', { class: 'small', style: 'margin:0;padding-left:18px' },
      [
        ...(assessment.reasons ?? []).map((reason) => ASSESSMENT_REASON_TEXT[reason]),
        ...(assessment.note ? [assessment.note] : []),
      ].map((line) => h('li', {}, line))),
    h('p', { class: 'small muted' },
      'This decision belongs to this exact version. A re-upload is a new version and needs a new look.'));
}

/**
 * The decision form.
 *
 * The reason codes are checkboxes over a closed set, and the submit control
 * refuses a non-acceptance with none ticked — the same refusal
 * `AssessmentDecisionSchema` makes server-side. A student told "rejected" with
 * a free-text note reading "wrong" has been given a support ticket, not a
 * decision they can act on.
 */
function decisionForm(row) {
  const { document } = row;
  const chosen = new Set();
  const note = h('textarea', {
    rows: '2', 'aria-label': 'Anything else the student should know',
    placeholder: 'Optional. Added after the reasons below, never instead of them.',
  });

  const reasonBoxes = h('div', { class: 'stack-sm' },
    ASSESSMENT_REASONS.map((reason) =>
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          onChange: (event) => {
            if (event.target.checked) chosen.add(reason);
            else chosen.delete(reason);
          },
        }),
        h('span', { class: 'small' }, ASSESSMENT_REASON_TEXT[reason]))));

  const reasonsBlock = h('div', { class: 'stack-sm', hidden: true },
    h('span', { class: 'small muted' }, 'Why? The student is shown these sentences.'),
    reasonBoxes);

  const decision = h('select', { 'aria-label': 'Decision', style: 'width:auto' },
    h('option', { value: 'accepted' }, 'Accept — usable as it stands'),
    h('option', { value: 'more_information' }, 'Needs more information'),
    h('option', { value: 'rejected' }, 'Not accepted'));

  decision.addEventListener('change', () => {
    reasonsBlock.hidden = decision.value === 'accepted';
  });

  const submit = async () => {
    const value = decision.value;
    const reasons = [...chosen];
    if (value !== 'accepted' && reasons.length === 0) {
      toast('Refused: a decision that is not an acceptance has to name at least one reason.');
      return;
    }
    if (escalatesToTrust({ reasons })) {
      const confirmed = await confirmDialog({
        title: 'This opens a trust case',
        body: h('div', { class: 'stack-sm' },
          h('p', { class: 'small muted' },
            '"Suspected alteration" is an allegation about a person, not a bad scan. It goes in '
            + 'front of Trust with its evidence rather than staying in a reviewer’s note.'),
          h('p', { class: 'small muted' },
            'The student is told the file could not be accepted and asked for the original. They '
            + 'are not accused of anything by this console.')),
        confirmLabel: 'Record it and open the case',
      });
      if (!confirmed) return;
      update((state) => state.trustCases.unshift({
        id: `case-doc-${Date.now().toString(36)}`,
        type: 'document_integrity',
        targetType: 'document',
        targetId: document.id,
        reporterId: 'M. Haddad (Trust)',
        severity: 'high',
        state: 'open',
        openedAt: new Date().toISOString(),
        summary: `A reviewer could not accept ${DOCUMENT_TYPE_LABELS[document.type] ?? document.type} `
          + `version ${document.version} and flagged it for integrity review.`,
        evidence: [`document-assessment:${versionKey(document)}`],
      }));
    }

    decideDocument(document, { decision: value, reasons, note: note.value.trim() });
    toast('Decision recorded against this version.');
  };

  return h('div', { class: 'stack-sm' },
    h('p', { class: 'small muted' },
      'Opened by ', h('strong', {}, row.assessment.openedBy ?? 'you'), ' at ',
      formatDateTime(row.assessment.openedAt), '.'),
    h('div', { class: 'row' }, h('label', { class: 'field' }, 'Decision', decision)),
    reasonsBlock,
    h('label', { class: 'field' }, 'Anything else the student should know (optional)', note),
    h('div', { class: 'row' },
      button('Record the decision', () => { void submit(); }, 'primary', { class: 'btn btn-primary btn-sm' })));
}

function accessLog() {
  const entries = store.state.documentAccessLog;
  return card(
    h('h2', {}, 'Who opened what'),
    h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
      'Reading a student’s document is the action with the privacy cost, so it is recorded like a '
      + 'write. In the platform proper this is an ', h('span', { class: 'mono' }, 'audit_events'),
      ' row on an append-only table; here it is the same record, in this browser.'),
    entries.length === 0
      ? empty('Nobody has opened a document in this session.')
      : table([{ label: 'When' }, { label: 'Who' }, { label: 'Document' }],
          entries.map((entry) => [
            formatDateTime(entry.at),
            entry.by,
            `${DOCUMENT_TYPE_LABELS[entry.type] ?? entry.type} · version ${entry.version}`,
          ])));
}
