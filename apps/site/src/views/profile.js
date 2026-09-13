import { h, link, badge, button, card, table, formatDate, formatDateTime, titleCase, toast } from '../ui.js';
import {
  store, update, recordUpload, removeDocument, assessmentFor, asDocumentVersion,
} from '../store.js';
import {
  ASSESSMENT_REASON_TEXT, ASSESSMENT_SLA_HOURS, assessmentState, connectorBlockReason,
  isConnectorEligible, isPermanentlyBlocked, missingCoreTypes,
} from '../engine.js';

const DOCUMENT_TYPES = {
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

/**
 * Profile and document vault.
 *
 * The completeness indicator says what is missing. It is never an admission
 * likelihood — that is a product boundary, not a copy preference, so there is
 * no percentage anywhere on this page that could be read as a chance of
 * getting in.
 */
export function profileView() {
  const profile = store.state.profile;
  const documents = store.state.documents;
  const missing = missingFields(profile);

  const set = (key, value) => update((state) => { state.profile[key] = value; state.profile.updatedAt = new Date().toISOString(); });

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'Your profile'),
    h('p', { class: 'muted' },
      'Filled in once and reused for every application. Nothing here is shared with a university until you consent ',
      'to a specific submission, and the consent names the exact documents.'),

    missing.length > 0
      ? h('p', { class: 'notice notice-info' },
          `${missing.length} thing${missing.length === 1 ? '' : 's'} still missing: ${missing.join(', ')}. `
          + 'This is a completeness check, not a judgement — nothing here predicts an admission decision.')
      : h('p', { class: 'notice notice-success' }, 'Everything the eligibility engine needs is filled in.'),

    h('div', { class: 'split wide' },
      h('div', { class: 'stack' },
        card(h('h2', {}, 'About you'),
          h('div', { class: 'grid grid-2', style: 'margin-top:12px' },
            textField('Date of birth', profile.dateOfBirth ?? '', (value) => set('dateOfBirth', value), 'date'),
            textField('Nationality (ISO code)', profile.nationality ?? '', (value) => set('nationality', value.toUpperCase())),
            textField('Country of residence', profile.countryOfResidence ?? '', (value) => set('countryOfResidence', value.toUpperCase())),
            textField('Work experience (months)', String(profile.workExperienceMonths ?? ''), (value) => set('workExperienceMonths', Number(value) || 0), 'number'))),

        card(h('h2', {}, 'What you are looking for'),
          h('div', { class: 'grid grid-2', style: 'margin-top:12px' },
            selectField('Level', profile.intendedLevel, ['foundation', 'undergraduate', 'postgraduate_taught', 'postgraduate_research', 'doctorate'], (value) => set('intendedLevel', value)),
            textField('Subject area', profile.intendedField ?? '', (value) => set('intendedField', value)),
            textField('Target intake (YYYY-MM)', profile.targetIntake ?? '', (value) => set('targetIntake', value)),
            textField('Budget per year (major units)', String((profile.budgetPerYear?.amountMinor ?? 0) / 100), (value) =>
              set('budgetPerYear', { amountMinor: Math.round(Number(value) * 100), currency: profile.budgetPerYear?.currency ?? 'GBP' }), 'number'))),

        card(h('h2', {}, 'Academic history'),
          table([{ label: 'Level' }, { label: 'Institution' }, { label: 'Country' }, { label: 'Field' }, { label: 'Grade' }, { label: 'Completed' }],
            profile.academicRecords.map((record) => [
              titleCase(record.level), record.institutionName, record.countryCode, record.fieldOfStudy,
              record.grade === null ? '—' : `${record.grade.value} (${record.grade.scale})`,
              record.completedAt === null ? 'In progress' : formatDate(record.completedAt),
            ]))),

        card(h('h2', {}, 'Language tests'),
          table([{ label: 'Test' }, { label: 'Overall', numeric: true }, { label: 'Bands' }, { label: 'Taken' }, { label: 'Expires' }],
            profile.languageTests.map((test) => [
              test.test.toUpperCase(), String(test.overall),
              Object.entries(test.bands).map(([band, score]) => `${band} ${score}`).join(', '),
              formatDate(test.takenAt), formatDate(test.expiresAt),
            ])),
          h('p', { class: 'small muted', style: 'margin-top:10px' },
            'An expired test is not a missing test and not a failing one. The vault warns before it becomes urgent.'))),

      h('aside', { class: 'stack' },
        documentVault(documents),

        card(h('h3', {}, 'Privacy'),
          h('p', { class: 'small muted', style: 'margin-top:8px' },
            'You can export or erase everything this browser holds. There is no account behind it and nothing to ask us for.'),
          h('div', { class: 'row' },
            button('Export my data', () => {
              const payload = JSON.stringify(store.state, null, 2);
              navigator.clipboard?.writeText(payload).then(
                () => toast('Copied to the clipboard.'),
                () => toast('Clipboard blocked; use the reset control in the footer instead.'));
            }, 'secondary'),
            link('/applications', 'What has been shared', { class: 'btn btn-ghost btn-sm' }))))));
}

/**
 * The document vault, as the student works it.
 *
 * The upload is real in the only sense a build with no server can make it real:
 * the file is read here, hashed with the same SHA-256 the API verifies uploads
 * against, and its true size and type recorded. What does not happen is a
 * network request — and the page says so rather than implying a vault that is
 * not there.
 *
 * Every state a document can be in is shown with the sentence that explains it,
 * and both come from the shared contract: `connectorBlockReason` writes the
 * "why can I not send this" line, `assessmentState` the review badge, and
 * `ASSESSMENT_REASON_TEXT` the reviewer's decision. A student is never shown a
 * status with no next step.
 */
function documentVault(documents) {
  const missing = missingCoreTypes(documents
    .filter((one) => isConnectorEligible(asDocumentVersion(one)))
    .map((one) => one.type));

  return card(
    h('h2', {}, 'Document vault'),
    h('p', { class: 'small muted', style: 'margin:6px 0 12px' },
      'Upload once, reuse for every application. A file is checked before it can be sent, and it '
      + 'is sent only when you consent to a specific submission that names it.'),

    missing.length > 0
      ? h('p', { class: 'notice notice-info small' },
          'Most applications need ', missing.map((type) => DOCUMENT_TYPES[type] ?? type).join(', '),
          '. This is a completeness check, not a judgement — nothing here predicts an admission decision.')
      : h('p', { class: 'notice notice-success small' },
          'Passport, transcript and language test are all on file and usable.'),

    h('div', { class: 'stack-sm', style: 'margin-top:12px' }, documents.map(documentRow)),

    uploadControl(),

    h('p', { class: 'small muted', style: 'margin-top:12px' },
      'Nothing is uploaded anywhere. The file is read in this tab to compute its checksum and size, '
      + 'and the contents are never written to this browser’s storage — a vault that leaves passport '
      + 'scans in a shared browser has recreated the problem it exists to solve. In the platform '
      + 'proper the bytes go straight to encrypted storage, every version is scanned, and the '
      + 'submission snapshot references the exact version by checksum.'));
}

function documentRow(document) {
  const version = asDocumentVersion(document);
  const assessment = assessmentFor(document);
  const blockReason = connectorBlockReason(version);
  const review = assessmentState(version, assessment === null ? null : {
    decision: assessment.decision ?? null,
    startedAt: assessment.openedAt ?? null,
  });

  return h('article', { class: 'card flat stack-sm', style: 'padding:12px' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('strong', { class: 'small' }, document.displayName),
        h('span', { class: 'small muted' },
          `${DOCUMENT_TYPES[document.type] ?? document.type} · version ${document.version} · ${document.sizeKb} kB`),
        h('span', { class: 'mono small' }, document.checksum ?? '—')),
      h('div', { class: 'chips' },
        badge(blockReason === null ? 'Ready to send' : titleCase(document.state),
          blockReason === null ? 'success' : 'warning'),
        reviewBadge(review))),

    blockReason === null ? null : h('p', { class: 'notice notice-warning small' }, blockReason),

    isPermanentlyBlocked(version)
      ? h('p', { class: 'small muted' },
          'This version stays blocked. Uploading a clean copy creates a new version; it does not '
          + 'reopen this one.')
      : null,

    assessment?.decidedAt != null ? decisionBlock(assessment) : null,

    h('div', { class: 'row' },
      replaceControl(document),
      button('Remove', () => {
        removeDocument(document.id);
        toast('Removed from the vault. Applications already submitted are unaffected — they reference the exact version that was sent.');
      }, 'ghost', { class: 'btn btn-ghost btn-sm' })));
}

const REVIEW_LABELS = {
  awaiting_scan: 'Being checked',
  awaiting_review: `Queued for review (within ${ASSESSMENT_SLA_HOURS} h)`,
  in_review: 'With a reviewer',
  accepted: 'Accepted by a reviewer',
  more_information: 'More information needed',
  rejected: 'Not accepted',
};

const REVIEW_TONES = {
  awaiting_scan: 'neutral',
  awaiting_review: 'neutral',
  in_review: 'info',
  accepted: 'success',
  more_information: 'warning',
  rejected: 'danger',
};

function reviewBadge(state) {
  return badge(REVIEW_LABELS[state] ?? state, REVIEW_TONES[state] ?? 'neutral');
}

function decisionBlock(assessment) {
  return h('div', { class: `notice notice-${assessment.decision === 'accepted' ? 'success' : assessment.decision === 'rejected' ? 'danger' : 'warning'} small` },
    h('strong', {}, `Reviewed ${formatDateTime(assessment.decidedAt)}. `),
    h('ul', { style: 'margin:6px 0 0;padding-left:18px' },
      [
        ...(assessment.reasons ?? []).map((reason) => ASSESSMENT_REASON_TEXT[reason]),
        ...(assessment.note ? [assessment.note] : []),
      ].map((line) => h('li', {}, line))));
}

/** Replacing a document writes a new version; the old decision does not carry. */
function replaceControl(document) {
  const input = h('input', {
    type: 'file',
    accept: '.pdf,.jpg,.jpeg,.png',
    class: 'visually-hidden',
    id: `replace-${document.id}`,
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;
      const { refused } = await recordUpload(file, document.type, { replacing: document.id });
      event.target.value = '';
      toast(refused
        ?? `Uploaded as version ${document.version + 1}. A new version needs a new look, so any earlier decision no longer applies.`);
    },
  });
  return h('span', {},
    input,
    h('label', { class: 'btn btn-secondary btn-sm', for: `replace-${document.id}` }, 'Upload a new version'));
}

function uploadControl() {
  const type = h('select', { 'aria-label': 'Document type', style: 'width:auto' },
    Object.entries(DOCUMENT_TYPES).map(([value, label]) => h('option', { value }, label)));

  const input = h('input', {
    type: 'file',
    accept: '.pdf,.jpg,.jpeg,.png',
    class: 'visually-hidden',
    id: 'vault-upload',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;
      const { refused } = await recordUpload(file, type.value);
      event.target.value = '';
      toast(refused ?? 'Added to the vault. It is queued for review.');
    },
  });

  return h('div', { class: 'row', style: 'margin-top:14px' },
    h('label', { class: 'field' }, 'What is this document?', type),
    input,
    h('label', { class: 'btn btn-primary btn-sm', for: 'vault-upload' }, 'Choose a file'),
    h('span', { class: 'small muted' }, 'PDF, JPG or PNG, up to 20 MB.'));
}

function missingFields(profile) {
  const missing = [];
  if (profile.dateOfBirth === null) missing.push('date of birth');
  if (profile.nationality === null) missing.push('nationality');
  if (profile.academicRecords.length === 0) missing.push('academic history');
  if (profile.languageTests.length === 0) missing.push('a language test');
  if (profile.workExperienceMonths === null) missing.push('work experience');
  return missing;
}

function textField(label, value, onChange, type = 'text') {
  return h('label', { class: 'field' }, label,
    h('input', { type, value, onChange: (event) => onChange(event.target.value) }));
}

function selectField(label, value, values, onChange) {
  return h('label', { class: 'field' }, label,
    h('select', { onChange: (event) => onChange(event.target.value) },
      values.map((one) => h('option', { value: one, selected: value === one }, titleCase(one)))));
}
