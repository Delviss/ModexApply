import {
  h, link, badge, button, card, empty, table, money, formatDate, formatDateTime, toast,
  confirmDialog, downloadJson, titleCase,
} from '../ui.js';
import {
  programmeByKey, eligibilityFor, applications, applicationById, applicationFor,
  store, update, updateQuietly, id, feesUsable, offersFor, offerValueMinor,
} from '../store.js';
import {
  canonicalJson, canTransition, humanState, submissionDisplayState, submissionHeadline,
  SUBMISSION_CONSENTS, SUBMISSION_CONSENT_NOTICE_VERSION, checksum,
} from '../engine.js';
import { feeLine, provenanceStamp, verdictBadge, INTAKE_LABELS, INTAKE_TONES } from './components.js';

const STEPS = ['Intake', 'Readiness', 'Consents', 'Review', 'Submit'];

/**
 * The application wizard.
 *
 * The order is not cosmetic. Consents come before the review and the review
 * before the submit, because the snapshot is taken at submit time and has to be
 * able to record exactly which consent wording the student agreed to and which
 * document versions existed when they did.
 */
export function applyView(programKey, query) {
  const programme = programmeByKey(programKey);
  if (programme === null) {
    return h('div', { class: 'wrap stack' }, h('h1', {}, 'Programme not found'), link('/programmes', 'Back to search'));
  }

  const existing = applicationFor(programKey);
  if (existing !== null && existing.state !== 'draft') {
    return h('div', { class: 'wrap stack' },
      h('h1', {}, 'You already have an application for this programme'),
      h('p', { class: 'muted' }, `It is ${humanState(existing.state)}.`),
      link(`/applications/${existing.id}`, 'Open it', { class: 'btn btn-primary' }));
  }

  if (programme.institution.connector.kind === 'none') {
    return h('div', { class: 'wrap stack' },
      h('h1', {}, 'No direct route to this university yet'),
      h('p', { class: 'notice notice-warning' },
        `Modex has no agreed application route with ${programme.institution.displayName}, so an application cannot be `
        + 'submitted from here. Nothing about that is hidden behind a "coming soon" button: apply on the university’s '
        + 'own site, and use the catalogue and the guides here for everything else.'),
      h('p', {},
        h('a', { href: programme.institution.websiteUrl, class: 'btn btn-secondary', rel: 'noopener noreferrer nofollow' },
          'Open the university’s site'),
        ' ',
        link(`/programmes/${programKey}`, 'Back to the programme', { class: 'btn btn-ghost' })));
  }

  const step = Math.min(Number(query.step ?? 1), STEPS.length);
  const draft = ensureDraft(programme);
  const goto = (next) => { location.hash = `#/apply/${programKey}?step=${next}`; };

  return h('div', { class: 'wrap stack' },
    h('nav', { class: 'small muted', 'aria-label': 'Breadcrumb' },
      link('/programmes', 'Programmes'), ' / ',
      link(`/programmes/${programKey}`, programme.name), ' / Apply'),
    h('h1', {}, `Apply — ${programme.name}`),
    h('p', { class: 'muted' },
      `${programme.institution.displayName} · you own this application at every step. `,
      'Modex is not an agent and cannot influence the decision.'),
    h('ol', { class: 'steps' }, STEPS.map((label, index) =>
      h('li', {
        ...(index + 1 === step ? { 'aria-current': 'step' } : {}),
        class: index + 1 < step ? 'done' : '',
      }, `${index + 1}. ${label}`))),
    [intakeStep, readinessStep, consentStep, reviewStep, submitStep][step - 1](programme, draft, goto));
}

function ensureDraft(programme) {
  const existing = applicationFor(programme.programKey);
  if (existing !== null) return existing;
  const draft = {
    id: id('app'),
    programKey: programme.programKey,
    intakeId: programme.intakes[0]?.id ?? null,
    state: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    externalRef: null,
    submissionNo: null,
    snapshot: null,
    checksum: null,
    consents: [],
    documentIds: [],
    offer: null,
    events: [{ at: new Date().toISOString(), text: 'Application started.' }],
  };
  updateQuietly((state) => state.applications.unshift(draft));
  return draft;
}

function patch(applicationId, changes, event) {
  update((state) => {
    const application = state.applications.find((one) => one.id === applicationId);
    if (application === undefined) return;
    Object.assign(application, changes, { updatedAt: new Date().toISOString() });
    if (event) application.events.push({ at: new Date().toISOString(), text: event });
  });
}

function intakeStep(programme, draft, goto) {
  return card(
    h('h2', {}, 'Which intake?'),
    h('div', { class: 'stack', style: 'margin-top:12px' },
      programme.intakes.map((intake) => h('label', { class: 'check' },
        h('input', {
          type: 'radio', name: 'intake', checked: draft.intakeId === intake.id,
          onChange: () => patch(draft.id, { intakeId: intake.id }),
        }),
        h('span', {},
          h('strong', {}, `Starts ${formatDate(intake.startDate)}`),
          ' · apply by ', formatDate(intake.applicationDeadline), ' ',
          badge(INTAKE_LABELS[intake.status], INTAKE_TONES[intake.status]),
          h('span', { class: 'small muted', style: 'display:block' },
            intake.capacity === null ? 'Capacity not published.' : `Capacity ${intake.capacity}.`))))),
    h('div', { class: 'row', style: 'margin-top:16px' },
      button('Continue', () => goto(2), 'primary', { disabled: draft.intakeId === null })));
}

function readinessStep(programme, draft, goto) {
  const { checks, verdict } = eligibilityFor(programme);
  const usable = store.state.documents.filter((one) => one.state === 'clean');
  const blocked = store.state.documents.filter((one) => one.state !== 'clean');
  const openTasks = checks.filter((check) => check.outcome === 'missing_data' || check.outcome === 'fail');

  return card(
    h('h2', {}, 'Readiness'),
    h('p', { class: 'small muted', style: 'margin:6px 0 14px' },
      'What is outstanding, and what to do about it. An open task is never a rejection — the university has not seen ',
      'this application yet.'),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, verdictBadge(verdict)),
    openTasks.length === 0
      ? h('p', { class: 'notice notice-success' }, 'Nothing outstanding against the published requirements.')
      : table([{ label: 'Task' }, { label: 'Owner' }, { label: 'What to do' }],
          openTasks.map((check) => [
            check.requirement,
            'You',
            check.remedy ?? check.reason,
          ])),
    h('h3', { style: 'margin-top:18px' }, 'Documents to include'),
    h('div', { class: 'stack-sm', style: 'margin-top:8px' },
      usable.map((document) => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: draft.documentIds.includes(document.id),
          onChange: (event) => patch(draft.id, {
            documentIds: event.target.checked
              ? [...draft.documentIds, document.id]
              : draft.documentIds.filter((one) => one !== document.id),
          }),
        }),
        h('span', {}, h('strong', {}, document.displayName),
          h('span', { class: 'small muted' }, ` · ${titleCase(document.type)} · version ${document.version} · ${document.checksum}`))))),
    blocked.length > 0
      ? h('p', { class: 'notice notice-warning small', style: 'margin-top:12px' },
          'Not available to send: ',
          blocked.map((document) => `${document.displayName} — ${document.quarantineReason ?? 'still being scanned'}`).join('; '),
          '. A quarantined document is missing data, not a failed requirement.')
      : null,
    h('div', { class: 'row', style: 'margin-top:16px' },
      button('Back', () => goto(1), 'ghost'),
      button('Continue', () => goto(3), 'primary', { disabled: draft.documentIds.length === 0 })));
}

function consentStep(programme, draft, goto) {
  const filled = (body) => body
    .replace('{institution}', programme.institution.displayName)
    .replace('{documentCount}', String(draft.documentIds.length));

  return card(
    h('h2', {}, 'Consents'),
    h('p', { class: 'small muted', style: 'margin:6px 0 14px' },
      'Three separately-worded consents, none pre-checked, none bundled. The API refuses a submission that is ',
      'missing any of them, so this is not a formality in the interface.'),
    h('div', { class: 'stack' }, SUBMISSION_CONSENTS.map((consent) =>
      h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: draft.consents.includes(consent.id),
          onChange: (event) => patch(draft.id, {
            consents: event.target.checked
              ? [...draft.consents, consent.id]
              : draft.consents.filter((one) => one !== consent.id),
          }, event.target.checked ? `Consent given: ${consent.title}.` : `Consent withdrawn: ${consent.title}.`),
        }),
        h('span', {}, h('strong', {}, consent.title),
          h('span', { class: 'small muted', style: 'display:block' }, filled(consent.body)))))),
    h('p', { class: 'small muted', style: 'margin-top:12px' },
      `Consent wording version ${SUBMISSION_CONSENT_NOTICE_VERSION}, recorded in the snapshot with the exact text above.`),
    h('div', { class: 'row', style: 'margin-top:16px' },
      button('Back', () => goto(2), 'ghost'),
      button('Continue', () => goto(4), 'primary', {
        disabled: draft.consents.length !== SUBMISSION_CONSENTS.length,
      })));
}

function snapshotFor(programme, draft) {
  const documents = store.state.documents.filter((one) => draft.documentIds.includes(one.id));
  const intake = programme.intakes.find((one) => one.id === draft.intakeId) ?? null;
  return {
    application: { id: draft.id, programKey: draft.programKey, intakeId: draft.intakeId },
    institution: { id: programme.institution.id, name: programme.institution.displayName },
    programme: {
      id: programme.id,
      version: programme.version,
      name: programme.name,
      requirementIds: programme.requirements.map((one) => one.id),
      fees: feesUsable(programme.fees)
        ? { tuitionMinor: programme.fees.tuitionMinor, currency: programme.fees.tuitionCurrency }
        : null,
    },
    intake: intake === null ? null : { id: intake.id, startDate: intake.startDate, deadline: intake.applicationDeadline },
    student: {
      nationality: store.state.profile.nationality,
      dateOfBirth: store.state.profile.dateOfBirth,
      academicRecords: store.state.profile.academicRecords,
      languageTests: store.state.profile.languageTests,
      workExperienceMonths: store.state.profile.workExperienceMonths,
    },
    documents: documents.map((one) => ({ id: one.id, type: one.type, version: one.version, checksum: one.checksum })),
    consents: {
      version: SUBMISSION_CONSENT_NOTICE_VERSION,
      given: draft.consents,
    },
  };
}

function reviewStep(programme, draft, goto) {
  const snapshot = snapshotFor(programme, draft);
  const canonical = canonicalJson(snapshot);

  return card(
    h('h2', {}, 'Review'),
    h('p', { class: 'small muted', style: 'margin:6px 0 14px' },
      'This is the exact payload that will be sent, in canonical form. The snapshot is immutable once submitted: ',
      'the submitted payload can be regenerated from it and byte-compared.'),
    h('pre', {
      class: 'mono',
      style: 'background:var(--subtle);padding:14px;border-radius:8px;overflow:auto;max-height:340px',
    }, canonical),
    h('div', { class: 'row', style: 'margin-top:16px' },
      button('Back', () => goto(3), 'ghost'),
      button('Continue to submit', () => goto(5), 'primary')));
}

function submitStep(programme, draft, goto) {
  const connector = programme.institution.connector;
  const state = h('div', { class: 'stack' });

  const submit = async () => {
    const confirmed = await confirmDialog({
      title: 'Send this application?',
      body: `It goes to ${programme.institution.displayName} over ${connector.name}. `
        + 'Once it is sent you cannot edit it — a change after that would make the snapshot describe something that no longer exists.',
      confirmLabel: 'Send it',
    });
    if (!confirmed) return;

    const snapshot = snapshotFor(programme, draft);
    const canonical = canonicalJson(snapshot);
    const digest = await checksum(canonical);

    patch(draft.id, { state: 'submitted_pending', snapshot, checksum: digest },
      `Payload built and handed to ${connector.name}. Nothing is reported as submitted until the university confirms receipt.`);

    // The connector's confirmation is the only thing that turns "sending" into
    // "submitted". Modelled here as the delay the real route has.
    const wait = Math.min((connector.medianAckSeconds ?? 60) * 12, 2600);
    setTimeout(() => {
      const reference = `${programme.institution.id === 'inst-northern' ? 'NIT' : 'EX'}-2026-${Math.floor(Math.random() * 900_000 + 100_000)}`;
      patch(draft.id, {
        state: 'submitted',
        submittedAt: new Date().toISOString(),
        externalRef: reference,
        submissionNo: 1,
      }, `University confirmed receipt and returned reference ${reference}.`);
      toast('The university confirmed receipt.');
      location.hash = `#/applications/${draft.id}`;
    }, wait);
  };

  const current = applicationById(draft.id);
  const display = submissionDisplayState(current.state);

  state.append(
    card(
      h('h2', {}, 'Submit'),
      h('p', { class: 'notice notice-info small' },
        submissionHeadline(current.state, programme.institution.displayName, current.externalRef),
        ' · ', connectorSentence(connector)),
      display === 'sending'
        ? h('p', { class: 'muted' }, 'Waiting for the university to confirm receipt. This page updates itself.')
        : h('div', { class: 'row' },
            button('Back', () => goto(4), 'ghost'),
            button('Send to the university', submit, 'primary')),
      h('p', { class: 'small muted', style: 'margin-top:12px' },
        'A submission counts only when the university endpoint confirms receipt and returns a durable reference. ',
        'If it fails, the application returns to an editable state and says so.')));
  return state;
}

function connectorSentence(connector) {
  if (connector.kind === 'direct_api') return `Direct API, median confirmation ${connector.medianAckSeconds} seconds.`;
  if (connector.kind === 'secure_handoff') return 'Secure handoff to the university portal, which confirms receipt.';
  return 'No agreed route.';
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export function applicationsView() {
  const all = applications();
  if (all.length === 0) {
    return h('div', { class: 'wrap stack' },
      h('h1', {}, 'My applications'),
      empty('No applications yet.', link('/programmes', 'Find a programme', { class: 'btn btn-primary btn-sm' })));
  }

  return h('div', { class: 'wrap stack' },
    h('h1', {}, 'My applications'),
    h('p', { class: 'muted' }, 'One row per application, with the state the university put it in — never a state we inferred.'),
    all.map((application) => {
      const programme = programmeByKey(application.programKey);
      return h('article', { class: 'card stack-sm' },
        h('div', { class: 'row-between' },
          h('div', { class: 'stack-sm' },
            h('h3', {}, link(`/applications/${application.id}`, programme?.name ?? application.programKey)),
            h('p', { class: 'small muted' }, programme?.institution.displayName ?? '')),
          stateBadge(application, programme)),
        h('p', { class: 'small muted' },
          `Started ${formatDate(application.createdAt)}`,
          application.externalRef ? ` · university reference ${application.externalRef}` : '',
          application.offer ? ` · respond by ${formatDate(application.offer.respondBy)}` : ''),
        h('div', { class: 'row' },
          link(`/applications/${application.id}`, 'Open', { class: 'btn btn-secondary btn-sm' })));
    }));
}

function stateBadge(application, programme) {
  const display = submissionDisplayState(application.state);
  const tone = { not_submitted: 'neutral', sending: 'info', confirmed: 'success', failed: 'danger' }[display];
  return badge(
    submissionHeadline(application.state, programme?.institution.displayName ?? 'the university', application.externalRef),
    application.state === 'offer' ? 'brand' : tone);
}

export function applicationView(applicationId) {
  const application = applicationById(applicationId);
  if (application === null) {
    return h('div', { class: 'wrap stack' }, h('h1', {}, 'Application not found'), link('/applications', 'Back'));
  }
  const programme = programmeByKey(application.programKey);
  const institution = programme?.institution ?? null;

  return h('div', { class: 'wrap stack' },
    h('nav', { class: 'small muted' }, link('/applications', 'My applications'), ' / ', programme?.name ?? application.programKey),
    h('div', { class: 'row-between' },
      h('div', { class: 'stack-sm' },
        h('h1', {}, programme?.name ?? application.programKey),
        h('p', { class: 'muted' }, institution?.displayName ?? '')),
      stateBadge(application, programme)),

    application.state === 'offer' ? offerPanel(application, programme) : null,

    h('div', { class: 'split wide' },
      h('div', { class: 'stack' },
        card(h('h2', {}, 'History'),
          h('div', { class: 'stack-sm', style: 'margin-top:10px' },
            application.events.map((event) => h('p', { class: 'small' },
              h('span', { class: 'mono' }, formatDateTime(event.at)), ' — ', event.text)))),

        application.snapshot !== null
          ? card(h('h2', {}, 'Submission receipt'),
              table([{ label: 'Field' }, { label: 'Value' }], [
                ['Submission', `#${application.submissionNo}`],
                ['University reference', application.externalRef ?? '—'],
                ['Sent', formatDateTime(application.submittedAt)],
                ['Payload checksum', h('span', { class: 'mono' }, application.checksum)],
                ['Consent wording', SUBMISSION_CONSENT_NOTICE_VERSION],
                ['Documents', application.snapshot.documents.map((one) => `${one.type} v${one.version}`).join(', ')],
              ]),
              h('div', { class: 'row', style: 'margin-top:12px' },
                button('Download the snapshot', () =>
                  downloadJson(`modex-submission-${application.id}.json`, application.snapshot), 'secondary'),
                button('Verify the checksum', async () => {
                  const again = await checksum(canonicalJson(application.snapshot));
                  toast(again === application.checksum
                    ? 'The payload regenerates from the snapshot byte for byte.'
                    : 'The snapshot no longer reproduces the submitted payload.');
                }, 'ghost')),
              h('p', { class: 'small muted', style: 'margin-top:10px' },
                'The snapshot names exact document versions. Documents uploaded later are not part of this submission.'))
          : null),

      h('aside', { class: 'stack' },
        institution !== null
          ? card(h('h3', {}, 'Route'),
              h('p', { class: 'small muted', style: 'margin-top:8px' }, connectorSentence(institution.connector)),
              badge(titleCase(institution.connector.health),
                institution.connector.health === 'healthy' ? 'success' : 'warning'))
          : null,
        programme !== null ? card(feeLine(programme)) : null,
        card(h('h3', {}, 'Who to ask'),
          h('p', { class: 'small muted', style: 'margin-top:8px' },
            'Questions about the decision go to the university. Questions about living there go to a verified student guide.'),
          h('div', { class: 'row' },
            institution ? link(`/guides?institution=${institution.id}`, 'Find a guide', { class: 'btn btn-secondary btn-sm' }) : null)))));
}

function offerPanel(application, programme) {
  const offer = application.offer;
  const awarded = (offer.awardedOfferIds ?? [])
    .map((offerId) => offersFor(programme).find((one) => one.id === offerId))
    .filter(Boolean);

  return h('section', { class: 'card tinted stack' },
    h('div', { class: 'row-between' },
      h('h2', {}, `${titleCase(offer.kind)} offer`),
      badge(`Respond by ${formatDate(offer.respondBy)}`, 'warning')),
    h('p', { class: 'small muted' }, `Issued ${formatDate(offer.issuedAt)} by the university.`),
    offer.conditions.length > 0
      ? h('div', { class: 'stack-sm' },
          h('strong', { class: 'small' }, 'Conditions'),
          h('ul', { class: 'small muted', style: 'margin:0;padding-left:18px' },
            offer.conditions.map((condition) => h('li', {}, condition))))
      : null,
    awarded.length > 0
      ? h('p', { class: 'small' }, 'Applied to this offer: ',
          awarded.map((one) => badge(`${one.name} · ${money(offerValueMinor(one, programme), one.currency)}`, 'success')))
      : null,
    h('div', { class: 'row' },
      button('Accept the offer', async () => {
        const yes = await confirmDialog({
          title: 'Accept this offer?',
          body: 'Accepting tells the university you intend to enrol. Modex does not collect tuition or deposits — '
            + 'any payment goes to the university, in its own name.',
          confirmLabel: 'Accept',
        });
        if (!yes) return;
        if (!canTransition(application.state, 'accepted')) return;
        patch(application.id, { state: 'accepted' }, 'Offer accepted by the student.');
        toast('Offer accepted. The university has been told.');
      }, 'primary'),
      button('Decline', async () => {
        const yes = await confirmDialog({
          title: 'Decline this offer?',
          body: 'This is final for this application. A change of mind means a new application.',
          confirmLabel: 'Decline',
          tone: 'secondary',
        });
        if (!yes) return;
        patch(application.id, { state: 'declined' }, 'Offer declined by the student.');
      }, 'secondary')));
}
