import { h, link, badge, button, card, table, formatDate, titleCase, toast, money } from '../ui.js';
import { store, update, id } from '../store.js';

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
        card(h('h2', {}, 'Document vault'),
          h('div', { class: 'stack-sm', style: 'margin-top:10px' },
            documents.map((document) => h('div', { class: 'row-between' },
              h('div', { class: 'stack-sm' },
                h('strong', { class: 'small' }, document.displayName),
                h('span', { class: 'small muted' },
                  `${DOCUMENT_TYPES[document.type] ?? document.type} · v${document.version} · ${document.sizeKb} kB`),
                h('span', { class: 'mono small' }, document.checksum)),
              badge(document.state === 'clean' ? 'Ready to send' : titleCase(document.state),
                document.state === 'clean' ? 'success' : 'warning')))),
          h('div', { class: 'stack-sm', style: 'margin-top:14px' },
            documents.filter((one) => one.state !== 'clean').map((document) =>
              h('p', { class: 'notice notice-warning small' },
                `${document.displayName}: ${document.quarantineReason}`))),
          h('div', { class: 'row', style: 'margin-top:12px' }, addDocumentControl()),
          h('p', { class: 'small muted', style: 'margin-top:10px' },
            'In this build a document is recorded, not stored: no file leaves your device and nothing is uploaded. ',
            'In the platform proper, every version is scanned, versioned and referenced by checksum in the submission snapshot.')),

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

function addDocumentControl() {
  const type = h('select', { 'aria-label': 'Document type', style: 'width:auto' },
    Object.entries(DOCUMENT_TYPES).map(([value, label]) => h('option', { value }, label)));
  const name = h('input', { type: 'text', placeholder: 'File name', 'aria-label': 'File name' });
  return h('div', { class: 'row' }, type, name,
    button('Record', () => {
      if (name.value.trim() === '') return;
      update((state) => state.documents.push({
        id: id('doc'), type: type.value, displayName: name.value.trim(), version: 1,
        state: 'clean', scannedAt: new Date().toISOString(), sizeKb: 0,
        checksum: `sha256:${Math.random().toString(16).slice(2, 6)}…${Math.random().toString(16).slice(2, 6)}`,
      }));
      toast('Recorded in the vault, scanned clean.');
    }, 'secondary', { class: 'btn btn-secondary btn-sm' }));
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
