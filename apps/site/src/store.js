/**
 * The data layer.
 *
 * This build has no server: the catalogue and the guide roster are loaded from
 * `data/platform.json`, and everything a visitor does — a profile edit, an
 * application, a message, a university entered in the admin console — is held
 * in their own browser under one localStorage key. Nothing is transmitted
 * anywhere, which is stated on the page rather than buried here.
 *
 * The shape deliberately mirrors the API projections (`PublicInstitution`,
 * `PublicProgramme`, `PublicGuideProfile`, `Application`) so the views written
 * against it would need a change of transport, not a change of model, to run
 * against the real `/v1` API.
 */
import { evaluateRequirement, rollUpVerdict, matchGuides } from './engine.js';

const STORAGE_KEY = 'modex-apply/v4';

/** Where `data/platform.json` sits relative to the page, on any host. */
const dataUrl = new URL('data/platform.json', document.baseURI).href;

const listeners = new Set();

export const store = {
  seed: null,
  state: null,
  ready: false,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  persist();
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
  } catch {
    // A private window with storage blocked still gets a working session; it
    // just does not survive a reload. Losing the demo is not worth an error.
  }
}

export function update(mutator) {
  mutator(store.state);
  notify();
}

/**
 * A mutation made *during* a render — creating the draft an application wizard
 * is about to show, for instance. It persists but does not notify, because
 * notifying mid-render would re-enter the renderer and paint the page twice.
 */
export function updateQuietly(mutator) {
  mutator(store.state);
  persist();
}

export function resetLocalState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  store.state = initialState(store.seed);
  notify();
}

export async function load() {
  const response = await fetch(dataUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`The platform data failed to load (${response.status}).`);
  store.seed = await response.json();

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  store.state = saved !== null && saved.version === 4 ? saved : initialState(store.seed);
  store.ready = true;
  return store;
}

function initialState(seed) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  return {
    version: 4,
    signedIn: true,
    profile: structuredClone(seed.demoStudent.profile),
    documents: structuredClone(seed.demoStudent.documents),
    /** Universities entered through the admin console, on top of the register. */
    registerAdditions: [],
    /** Register decisions: `{ id, stage, state, note, evidence[], decidedAt }`. */
    registerDecisions: {},
    applications: [
      {
        id: 'app-seeded-ph',
        programKey: 'example-msc-public-health',
        intakeId: 'int-ex-ph-2027-01',
        state: 'offer',
        createdAt: '2026-08-02T09:12:00.000Z',
        updatedAt: '2026-09-06T15:20:00.000Z',
        submittedAt: '2026-08-14T11:02:00.000Z',
        externalRef: 'EX-2026-PH-004182',
        submissionNo: 1,
        snapshot: null,
        checksum: 'e3b0c44298fc1c149afbf4c8996fb924',
        consents: ['university_submission', 'document_share', 'decision_contact'],
        documentIds: ['doc-transcript', 'doc-passport', 'doc-ielts'],
        offer: {
          kind: 'conditional',
          issuedAt: '2026-09-06T15:20:00.000Z',
          respondBy: '2026-10-20T23:59:00.000Z',
          conditions: ['Certified copy of the final transcript', 'Deposit of £4,000 by 20 October 2026'],
          awardedOfferIds: ['off-ex-merit'],
        },
        events: [
          { at: '2026-08-02T09:12:00.000Z', text: 'Application started.' },
          { at: '2026-08-14T11:02:00.000Z', text: 'Payload sent over the Example Admissions API. University returned reference EX-2026-PH-004182.' },
          { at: '2026-08-21T08:40:00.000Z', text: 'University moved the application to review.' },
          { at: '2026-09-06T15:20:00.000Z', text: 'Conditional offer issued, with the International Merit Scholarship applied.' },
        ],
      },
    ],
    conversations: [
      {
        id: 'conv-amara',
        guideId: 'guide-amara',
        contextType: 'institution',
        contextId: 'inst-example',
        status: 'open',
        createdAt: dayAgo,
        messages: [
          {
            id: 'msg-1',
            senderRole: 'student',
            body: 'Hi Amara — I have an offer for the public health master’s and I am trying to work out accommodation. Did you get a room in halls?',
            at: dayAgo,
            findings: [],
          },
          {
            id: 'msg-2',
            senderRole: 'guide',
            body: 'Hello! I did, but only because I applied the same week I accepted. Rooms in the postgraduate hall went in about ten days last year. The deposit for the room is separate from the tuition deposit, which surprised me.',
            at: new Date(now.getTime() - 82_000_000).toISOString(),
            findings: [],
          },
        ],
      },
    ],
    sessions: [],
    trustCases: [
      {
        id: 'case-seeded-1',
        type: 'guide_expired',
        targetType: 'guide',
        targetId: 'guide-tomas',
        reporterId: 'system',
        severity: 'medium',
        state: 'resolved',
        openedAt: '2026-08-02T09:05:00.000Z',
        summary: 'Automatic: current-student evidence expired; messaging suspended by the reverification job with no human step.',
        evidence: ['guide-verification:guide-tomas#university_domain_email expired 2026-08-02'],
      },
    ],
    compare: [],
    reports: [],
    /** Guides suspended by the anti-scam pipeline in this browser. */
    guideSuspensions: {},
    /**
     * Review decisions, keyed by document id (Phase 8).
     *
     * Keyed by *version*, in effect: a re-upload bumps `version` and clears the
     * decision, because a verdict belongs to exact bytes. A rejected transcript
     * that silently becomes an accepted one the moment any replacement arrives
     * is the failure this shape exists to prevent.
     */
    documentAssessments: {},
    /** Who opened which document, and when. The privacy cost is in the opening. */
    documentAccessLog: [],
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const institutions = () => store.seed.institutions;

export const institutionById = (id) => store.seed.institutions.find((one) => one.id === id) ?? null;

/** Every programme, with its institution and campus joined on. */
export function programmes() {
  return store.seed.programmes.map(decorateProgramme);
}

export function programmeByKey(programKey) {
  const found = store.seed.programmes.find((one) => one.programKey === programKey);
  return found === undefined ? null : decorateProgramme(found);
}

function decorateProgramme(programme) {
  const institution = institutionById(programme.institutionId);
  const campus = institution?.campuses.find((one) => one.id === programme.campusId) ?? null;
  return { ...programme, institution, campus, visibility: visibilityOf(programme, institution) };
}

/**
 * A programme whose institution is not verified is shown *with a warning*, not
 * hidden and not presented as confirmed. Hiding it would push the student to a
 * worse source; presenting it plainly would be the lie this platform exists to
 * remove.
 */
function visibilityOf(programme, institution) {
  return institution?.verification.state === 'verified' && programme.provenance.syncState === 'synced'
    ? 'visible'
    : 'visible_with_warning';
}

/**
 * Money with an expiry, past its expiry, is withheld rather than shown.
 * "A wrong price is worse than an absent one" — Phase 1's freshness rule.
 */
export function feesUsable(fees, now = new Date()) {
  if (fees.provenance.expiresAt === null) return fees.provenance.verifiedAt !== null;
  return new Date(fees.provenance.expiresAt) > now;
}

/**
 * A guide's state, including any suspension the anti-scam pipeline applied in
 * this session. Everything that reads a state reads it through here, so a
 * suspended guide leaves the directory and loses messaging in one move rather
 * than in every caller.
 */
export function guideStateOf(guide) {
  return store.state.guideSuspensions[guide.id]?.state ?? guide.state;
}

export function suspendGuide(guideId, reason) {
  update((state) => {
    state.guideSuspensions[guideId] = { state: 'suspended', reason, at: new Date().toISOString() };
  });
}

export const guides = () =>
  store.seed.guides.map((guide) => ({ ...guide, state: guideStateOf(guide) }));

export const guideById = (id) => guides().find((one) => one.id === id) ?? null;
export const offers = () => store.seed.offers;
export const questions = () => store.seed.questions;

/** The register: entered universities plus anything added in this browser. */
export function registerEntries() {
  const decisions = store.state.registerDecisions;
  return [...store.seed.register.institutions, ...store.state.registerAdditions].map((entry) => ({
    ...entry,
    ...(decisions[entry.id] ?? {}),
    stage: decisions[entry.id]?.stage ?? entry.stage ?? 'submitted',
    verificationState: decisions[entry.id]?.state ?? 'unverified',
    evidence: decisions[entry.id]?.evidence ?? [],
  }));
}

export const REGISTER_STAGES = [
  'submitted',
  'identity_confirmed',
  'domain_confirmed',
  'signatory_confirmed',
  'contracted',
];

export const REGISTER_STAGE_LABELS = {
  submitted: 'Entered',
  identity_confirmed: 'Legal entity confirmed',
  domain_confirmed: 'Domain confirmed',
  signatory_confirmed: 'Signatory confirmed',
  contracted: 'Partnership signed',
};

/**
 * What each stage needs before it can be claimed.
 *
 * The admin console refuses to advance without the evidence, which is the
 * difference between a verification pipeline and a dropdown.
 */
export const REGISTER_STAGE_EVIDENCE = {
  identity_confirmed: 'Legal entity confirmed against the national register of the awarding country.',
  domain_confirmed: 'Official domain confirmed by a DNS TXT record published by the institution.',
  signatory_confirmed: 'Authorised signatory verified on an address at that domain.',
  contracted: 'Signed partnership contract on file, with the agreed scopes.',
};

// ---------------------------------------------------------------------------
// Eligibility — the API's own evaluators, over the profile in this browser
// ---------------------------------------------------------------------------

export function eligibilityFor(programme, now = new Date()) {
  const usable = new Set();
  const blocked = new Map();
  for (const document of store.state.documents) {
    if (document.state === 'clean') usable.add(document.type);
    else blocked.set(document.type, document.quarantineReason ?? 'This document is still being checked.');
  }

  const checks = programme.requirements.map((requirement) =>
    evaluateRequirement(
      {
        id: requirement.id,
        ruleType: requirement.ruleType,
        ruleJson: requirement.ruleJson,
        humanSummary: requirement.humanSummary,
        sourceRef: requirement.sourceRef,
      },
      store.state.profile,
      { now, usableDocumentTypes: usable, blockedDocumentTypes: blocked },
    ),
  );

  return { checks, verdict: rollUpVerdict(checks) };
}

export const VERDICT_LABELS = {
  eligible: 'Meets the published requirements',
  likely_eligible: 'Likely to meet the requirements',
  not_eligible: 'Does not meet a published requirement',
  insufficient_data: 'Not enough information yet',
};

export const VERDICT_TONES = {
  eligible: 'success',
  likely_eligible: 'info',
  not_eligible: 'danger',
  insufficient_data: 'neutral',
};

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/** Ranked guides for one institution, through the platform's own weights. */
export function matchedGuides(institutionId, options = {}) {
  const candidates = guides()
    .filter((guide) => guide.institutionId === institutionId)
    .map((guide) => ({ profile: toPublicProfile(guide), openSlots: guide.openSlots }));

  return matchGuides(candidates, {
    institutionId,
    campusId: options.campusId ?? null,
    campusSpecific: options.campusSpecific ?? false,
    programKey: options.programKey ?? null,
    discipline: options.discipline ?? store.state.profile.intendedField,
    level: options.level ?? store.state.profile.intendedLevel,
    languages: options.languages ?? ['en'],
    homeCountry: store.state.profile.nationality,
    topics: options.topics ?? [],
    requiresAvailability: options.requiresAvailability ?? false,
  });
}

/** The projection a student client receives. No contact details exist in it. */
export function toPublicProfile(guide) {
  const institution = institutionById(guide.institutionId);
  return {
    id: guide.id,
    displayName: guide.displayName,
    avatarRef: null,
    institutionId: guide.institutionId,
    institutionName: institution?.displayName ?? 'Unknown institution',
    campusId: guide.campusId,
    campusName: institution?.campuses.find((one) => one.id === guide.campusId)?.name ?? null,
    programKey: guide.programKey,
    programName: guide.programName,
    level: guide.level,
    yearOfStudy: guide.yearOfStudy,
    languages: guide.languages,
    homeCountry: guide.homeCountry,
    topics: guide.topics,
    bio: guide.bio,
    state: guide.state,
    verifiedAt: guide.verifiedAt,
    expiresAt: guide.expiresAt,
    responseTimeHours: guide.responseTimeHours,
    online: guide.online,
    trustScore: guide.trustScore,
    universityEndorsed: guide.universityEndorsed,
  };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export function offersFor(programme) {
  return store.seed.offers.filter(
    (offer) =>
      offer.institutionId === programme.institution?.id &&
      (offer.programKeys.length === 0 || offer.programKeys.includes(programme.programKey)),
  );
}

/** What an offer is worth against one programme, or null when it cannot be computed. */
export function offerValueMinor(offer, programme) {
  if (offer.valueKind === 'fixed_amount') return offer.valueMinor;
  if (offer.valueKind === 'percentage_of_tuition') {
    if (!feesUsable(programme.fees)) return null;
    return Math.round((programme.fees.tuitionMinor * offer.valuePercent) / 100);
  }
  return null;
}

/**
 * Verified savings only.
 *
 * An unverified offer never contributes to a total. A number a student plans
 * around has to be one somebody has signed for.
 */
export function verifiedSavings(programme) {
  return offersFor(programme)
    .filter((offer) => offer.verification.state === 'verified')
    .reduce((total, offer) => total + (offerValueMinor(offer, programme) ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const applications = () => store.state.applications;

export function applicationById(id) {
  return store.state.applications.find((one) => one.id === id) ?? null;
}

export function applicationFor(programKey) {
  return store.state.applications.find((one) => one.programKey === programKey) ?? null;
}

export function conversationWith(guideId) {
  return store.state.conversations.find((one) => one.guideId === guideId) ?? null;
}

export function openTrustCase(input) {
  const record = {
    id: `case-${Math.random().toString(36).slice(2, 9)}`,
    openedAt: new Date().toISOString(),
    state: 'open',
    ...input,
  };
  update((state) => state.trustCases.unshift(record));
  return record;
}

export const id = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

// ---------------------------------------------------------------------------
// The document vault (Phase 8)
//
// The upload here is real, in the only sense this build can make it real: the
// file is read in the browser, hashed with the same SHA-256 the API verifies
// uploads against, and its true size recorded. What does *not* happen is a
// network request — there is no server behind this page, and a build that
// pretended to store a passport scan would be worse than one that says it does
// not. The contents are never written to `localStorage` either: a vault that
// leaves identity documents in a shared browser's storage has recreated the
// problem it exists to solve.
// ---------------------------------------------------------------------------

/** The `DocumentVersion` shape the shared predicates in `engine.js` expect. */
export function asDocumentVersion(document) {
  return {
    id: `${document.id}@${document.version}`,
    documentId: document.id,
    version: document.version,
    objectKey: `documents/${document.id}`,
    checksum: document.checksum ?? null,
    sizeBytes: (document.sizeKb ?? 0) * 1024,
    contentType: document.contentType ?? null,
    scanState: document.state,
    scannedAt: document.scannedAt ?? null,
    scanDetail: document.quarantineReason ?? null,
    uploadComplete: document.uploadComplete ?? true,
    createdAt: document.uploadedAt ?? document.scannedAt ?? new Date().toISOString(),
  };
}

/** The key a decision hangs on: document *and* version. */
export const versionKey = (document) => `${document.id}@${document.version}`;

export const assessmentFor = (document) =>
  store.state.documentAssessments[versionKey(document)] ?? null;

/**
 * What the platform accepts at the door.
 *
 * Deliberately *not* dressed up as a scan. A browser cannot run a malware scan,
 * and a wrong file format is not a malware verdict — quarantining a `.txt` file
 * "because the scanner flagged it" would be exactly the unearned assurance this
 * product exists to remove. These are the two checks that are honest here: a
 * format no university will take, and a file over the size limit. Both refuse
 * the upload outright rather than admitting it in a blocked state, because
 * neither is something a reviewer or a scan could later resolve.
 *
 * The malware scan itself happens server-side in the platform proper, and the
 * vault says so on the page.
 */
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 20 * 1024 * 1024;

export function checkUpload(file) {
  if (file.size > MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB — send a smaller scan.`;
  }
  if (file.type !== '' && !ACCEPTED_TYPES.includes(file.type)) {
    return 'Universities take PDF, JPG or PNG. A document in another format cannot be forwarded.';
  }
  return null;
}

/**
 * Records an uploaded file in the vault.
 *
 * Replacing an existing document writes a **new version** rather than editing
 * the row: an application snapshot names exact versions, and that reference has
 * to keep resolving after a better scan arrives. The old decision does not
 * carry over, for the reason in `documentAssessments` above.
 */
export async function recordUpload(file, type, { replacing = null } = {}) {
  const refusal = checkUpload(file);
  if (refusal !== null) return { refused: refusal, document: null };

  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const now = new Date().toISOString();

  let recorded = null;
  update((state) => {
    const existing = replacing === null
      ? null
      : state.documents.find((one) => one.id === replacing) ?? null;

    if (existing !== null) {
      existing.version += 1;
      existing.displayName = file.name;
      existing.sizeKb = Math.max(1, Math.round(file.size / 1024));
      existing.contentType = file.type || null;
      existing.checksum = `sha256:${checksum}`;
      existing.state = 'clean';
      existing.quarantineReason = null;
      existing.scannedAt = now;
      existing.uploadedAt = now;
      existing.uploadComplete = true;
      // A new version is a new question for a reviewer.
      delete state.documentAssessments[versionKey(existing)];
      recorded = existing;
      return;
    }

    const document = {
      id: id('doc'),
      type,
      displayName: file.name,
      version: 1,
      state: 'clean',
      quarantineReason: null,
      scannedAt: now,
      uploadedAt: now,
      uploadComplete: true,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      contentType: file.type || null,
      checksum: `sha256:${checksum}`,
    };
    state.documents.push(document);
    recorded = document;
  });

  return { refused: null, document: recorded };
}

export function removeDocument(documentId) {
  update((state) => {
    state.documents = state.documents.filter((one) => one.id !== documentId);
  });
}

/**
 * Opening a document for review.
 *
 * Recorded rather than merely permitted, because the harm from an unnecessary
 * look at somebody's passport happens at the moment of looking and leaves
 * nothing else behind to find later. The API audits this for the same reason.
 */
export function openForReview(document, by = 'M. Haddad (Trust)') {
  const key = versionKey(document);
  update((state) => {
    const existing = state.documentAssessments[key] ?? null;
    state.documentAssessments[key] = {
      ...(existing ?? { decision: null, reasons: [], note: null }),
      documentId: document.id,
      version: document.version,
      openedAt: existing?.openedAt ?? new Date().toISOString(),
      openedBy: existing?.openedBy ?? by,
    };
    state.documentAccessLog.unshift({
      at: new Date().toISOString(),
      by,
      documentId: document.id,
      version: document.version,
      type: document.type,
    });
    state.documentAccessLog = state.documentAccessLog.slice(0, 50);
  });
}

/** Records a decision against the exact version that was opened. */
export function decideDocument(document, { decision, reasons, note }, by = 'M. Haddad (Trust)') {
  const key = versionKey(document);
  update((state) => {
    const existing = state.documentAssessments[key] ?? {};
    state.documentAssessments[key] = {
      ...existing,
      documentId: document.id,
      version: document.version,
      decision,
      reasons,
      note: note === '' ? null : note,
      reviewerId: by,
      decidedAt: new Date().toISOString(),
    };
  });
}
