import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildAccessContext } from '../../src/auth/access-context.js';
import { toAuditActor } from '../../src/auth/audit-actor.js';
import { AppError } from '../../src/common/errors/app-error.js';
import { payloadHash, verifySnapshot } from '../../src/common/crypto/payload-hash.js';
import { signWebhook } from '../../src/common/crypto/webhook-signature.js';
import { partnerIdempotencyKey } from '../../src/applications/submission.service.js';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  trustAgent,
  type Harness,
} from './harness.js';
import {
  SUBMISSION_CONSENTS,
  canonicalJson,
  type AccessContext,
  type SubmissionConsentId,
} from '@modex/contracts';

let prisma: PrismaClient;
let harness: Harness;

beforeAll(async () => {
  prisma = createPrisma();
  await prisma.$connect();
  harness = createHarness(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  harness.queue.clear();
  harness.connector.reset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function student(email = 'ada@example.com'): Promise<AccessContext> {
  const user = await prisma.user.create({
    data: { email, displayName: 'Ada Bello', status: 'active' },
  });
  return buildAccessContext({
    sessionId: 'session_test',
    userId: user.id,
    roles: ['student'],
    organisationId: null,
    mfaSatisfied: false,
    consents: [],
  });
}

async function activePartner(domain = 'example.ac.uk') {
  const institution = await harness.institutions.create(opsUser(), {
    legalName: 'The University of Example',
    displayName: 'University of Example',
    domains: [domain],
    country: 'GB',
  });
  const agent = trustAgent();

  await harness.institutions.recordEvidence(agent, institution.id, {
    stage: 'legal_entity_check',
    summary: 'Companies House record confirmed.',
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'legal_entity_check');

  const challenge = await harness.domains.issueChallenge(toAuditActor(agent), institution.id, domain);
  harness.dns.publish(`_modex-challenge.${domain}`, challenge.recordValue);
  await harness.domains.checkChallenge(toAuditActor(agent), challenge.id);
  await harness.institutions.advanceVerification(agent, institution.id, 'official_domain_confirmation');

  const contact = await harness.institutions.addContact(opsUser(), institution.id, {
    fullName: 'R. Adeyemi',
    email: `registrar@${domain}`,
    role: 'authorised_signatory',
    isAuthorisedSignatory: true,
  });
  await prisma.institutionContact.update({
    where: { id: contact.id },
    data: { verifiedAt: new Date() },
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'partner_contact_confirmation');
  await harness.institutions.updatePartnership(opsUser(), institution.id, {
    contractRef: 'contract://2026/example.pdf',
    scopes: ['catalogue_publish', 'direct_application'],
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'signed_contract');
  await harness.institutions.advanceVerification(agent, institution.id, 'active');

  return institution;
}

async function publishedProgramme(institutionId: string) {
  const program = await harness.catalogue.createProgram(opsUser(), institutionId, {
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing',
    durationMonths: 12,
  });
  const intake = await harness.catalogue.addIntake(opsUser(), program.programKey, {
    startDate: new Date('2027-09-01'),
    applicationDeadline: new Date('2027-07-01'),
  });
  await harness.catalogue.setFees(opsUser(), program.programKey, {
    tuition: { amountMinor: 2_400_000, currency: 'GBP' },
    sourceRef: 'https://example.ac.uk/fees',
  });
  await harness.catalogue.publishProgram(opsUser(), program.programKey);
  return { program, intake };
}

async function connectorFor(institutionId: string, overrides: Record<string, unknown> = {}) {
  return prisma.connectorConfig.create({
    data: {
      institutionId,
      type: 'api',
      displayName: 'University of Example direct API',
      endpointUrl: 'https://partner.example/applications',
      // A *name*, never the credential itself.
      credentialRef: 'partner-api',
      signingSecretRef: 'partner-webhook',
      enabled: true,
      featureFlag: 'connector.direct_application',
      ...overrides,
    },
  });
}

async function uploadDocument(
  access: AccessContext,
  options: { scan?: 'clean' | 'quarantined'; body?: string } = {},
) {
  const bytes = Buffer.from(options.body ?? 'a plausible transcript');
  const created = await harness.documents.createVersion(access, {
    type: 'transcript',
    displayName: 'Transcript.pdf',
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
  });
  harness.storage.put(created.version.objectKey, bytes);
  await harness.documents.finalise(access, created.version.id, {
    checksum: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  });
  harness.scanner.verdict =
    options.scan === 'quarantined'
      ? { state: 'quarantined', detail: 'Malware signature: Eicar-Test-Signature' }
      : { state: 'clean', detail: null };
  await harness.documents.runScan(created.version.id);
  return created;
}

/** A student with a profile, a clean document and every consent given. */
async function readyApplication(options: { documents?: boolean } = {}) {
  const institution = await activePartner();
  const { program, intake } = await publishedProgramme(institution.id);
  const connector = await connectorFor(institution.id);
  const access = await student();

  await harness.students.patch(access, {
    dateOfBirth: '2002-04-01',
    nationality: 'NG',
    countryOfResidence: 'NG',
    intendedLevel: 'postgraduate_taught',
    intendedField: 'Computing',
  });
  if (options.documents !== false) await uploadDocument(access);

  const created = await harness.applications.start(access, {
    programKey: program.programKey,
    intakeId: intake.id,
  });
  await harness.applications.recordConsents(
    access,
    created.id,
    SUBMISSION_CONSENTS.map((consent) => consent.id) as SubmissionConsentId[],
  );
  await harness.applications.markReady(access, created.id);

  return { access, applicationId: created.id, institution, program, intake, connector };
}

// ---------------------------------------------------------------------------

describe('the application lifecycle', () => {
  it('takes an application from draft to a confirmed submission with the university’s reference', async () => {
    // Acceptance criterion 1, end to end against a real database.
    const { access, applicationId } = await readyApplication();

    const result = await harness.applications.submit(access, applicationId);

    expect(result.state).toBe('submitted');
    expect(result.externalRef).toBe('UNI-REF-1');
    expect(result.headline).toBe('Submitted · confirmed by University of Example');

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('submitted');
    expect(stored.confirmedAt).not.toBeNull();
    expect(stored.currentOwner).toBe('university');
  });

  it('refuses to start a second application for the same intake', async () => {
    const { access, applicationId, program, intake } = await readyApplication();
    await expect(
      harness.applications.start(access, { programKey: program.programKey, intakeId: intake.id }),
    ).rejects.toMatchObject({ code: 'conflict', details: { applicationId } });
  });

  it('rejects an illegal transition at the database boundary, not only in the table', async () => {
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    // `submitted → ready` is not in the table; the service must refuse it even
    // though the row is right there to update.
    await expect(
      harness.applicationState.transition({
        applicationId,
        to: 'ready',
        actor: toAuditActor(access),
        authority: 'student',
      }),
    ).rejects.toBeInstanceOf(AppError);

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('submitted');
  });

  it('writes an audit event for every state change, with the authority recorded', async () => {
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    const trail = await harness.audit.trailFor('application', applicationId);
    const actions = trail.map((event) => event.action);
    expect(actions).toContain('application.created');
    expect(actions).toContain('application.snapshot_created');
    expect(actions).toContain('application.submission_attempted');
    expect(actions).toContain('application.submitted');

    const transitions = trail.filter((event) => event.action === 'application.state_changed');
    expect(transitions.map((event) => (event.metadata as { to: string }).to)).toEqual([
      'ready',
      'submitted_pending',
      'submitted',
    ]);
    // The move to `submitted` is the pipeline's to make, and the trail says so.
    expect((transitions.at(-1)!.metadata as { authority: string }).authority).toBe('system');
  });
});

describe('immutable snapshots', () => {
  it('does not change a historical submission when a document is updated afterwards', async () => {
    // Acceptance criterion 5.
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    const before = await harness.applications.reproduce(access, applicationId, 1);
    expect(before.verified).toBe(true);
    const originalBytes = canonicalJson(before.payload);

    // The student uploads a better scan of the same document.
    const document = await prisma.document.findFirstOrThrow({
      where: { ownerId: access.userId },
    });
    const replacement = Buffer.from('a much better scan of the same transcript');
    const created = await harness.documents.createVersion(access, {
      documentId: document.id,
      type: 'transcript',
      displayName: 'Transcript.pdf',
      contentType: 'application/pdf',
      sizeBytes: replacement.length,
    });
    harness.storage.put(created.version.objectKey, replacement);
    await harness.documents.finalise(access, created.version.id, {
      checksum: createHash('sha256').update(replacement).digest('hex'),
      sizeBytes: replacement.length,
    });
    await harness.documents.runScan(created.version.id);

    const after = await harness.applications.reproduce(access, applicationId, 1);
    expect(canonicalJson(after.payload)).toBe(originalBytes);
    expect(after.storedHash).toBe(before.storedHash);
    expect(after.verified).toBe(true);
    // Pinned to version 1, not to "whatever is current".
    expect(after.documentVersionIds).toEqual(before.documentVersionIds);
    expect(after.documentVersionIds).not.toContain(created.version.id);
  });

  it('regenerates the payload byte-for-byte and re-verifies its hash', async () => {
    // Acceptance criterion 6.
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({
      where: { applicationId },
    });
    const regenerated = canonicalJson(snapshot.payload);
    expect(payloadHash(snapshot.payload)).toBe(snapshot.payloadHash);
    expect(createHash('sha256').update(regenerated, 'utf8').digest('hex')).toBe(
      snapshot.payloadHash,
    );
    expect(verifySnapshot(snapshot).valid).toBe(true);
  });

  it('is append-only in the database, for the table owner as well as the app', async () => {
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);
    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({
      where: { applicationId },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE application_snapshots SET "payloadHash" = 'tampered' WHERE id = $1`,
        snapshot.id,
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM application_snapshots WHERE id = $1`, snapshot.id),
    ).rejects.toThrow(/append-only/);

    const unchanged = await prisma.applicationSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(unchanged.payloadHash).toBe(snapshot.payloadHash);
  });

  it('does not block deleting the application it describes', async () => {
    // The trap this design walked into once: a foreign key here would make the
    // append-only trigger fire on the cascade, and no application could ever be
    // erased. Proven rather than asserted.
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    await expect(prisma.application.delete({ where: { id: applicationId } })).resolves.toBeTruthy();
    expect(
      await prisma.applicationSnapshot.count({ where: { applicationId } }),
    ).toBeGreaterThan(0);
  });

  it('records the profile version as a content hash, not a counter', async () => {
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);
    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({
      where: { applicationId },
    });
    expect(snapshot.profileVersion).toHaveLength(32);
    expect((snapshot.payload as { profile: { profileVersion: string } }).profile.profileVersion).toBe(
      snapshot.profileVersion,
    );
  });
});

describe('the connector boundary', () => {
  it('never hands an unscanned or quarantined document to a connector', async () => {
    // Acceptance criterion 9, tested at the boundary rather than at the UI.
    const institution = await activePartner();
    const { program, intake } = await publishedProgramme(institution.id);
    await connectorFor(institution.id);
    const access = await student();
    await harness.students.patch(access, {
      dateOfBirth: '2002-04-01',
      nationality: 'NG',
      countryOfResidence: 'NG',
    });
    await uploadDocument(access, { scan: 'quarantined' });

    const created = await harness.applications.start(access, {
      programKey: program.programKey,
      intakeId: intake.id,
    });
    await harness.applications.recordConsents(
      access,
      created.id,
      SUBMISSION_CONSENTS.map((consent) => consent.id) as SubmissionConsentId[],
    );

    // It cannot even reach `ready`, and if it somehow did the payload builder
    // refuses too.
    await expect(harness.applications.markReady(access, created.id)).rejects.toMatchObject({
      code: 'precondition_failed',
    });
    await expect(harness.payloads.build(created.id)).rejects.toMatchObject({
      code: 'precondition_failed',
    });
    expect(harness.connector.calls).toHaveLength(0);
  });

  it('omits a still-pending document rather than sending it', async () => {
    const { access, applicationId } = await readyApplication();

    // A second upload that never finishes its scan.
    const bytes = Buffer.from('half an upload');
    const pending = await harness.documents.createVersion(access, {
      type: 'passport',
      displayName: 'Passport.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });

    const built = await harness.payloads.build(applicationId);
    expect(built.documentVersionIds).not.toContain(pending.version.id);
    // Everything that *did* make it carries a checksum, which is what pins the
    // snapshot to specific bytes rather than to a row id.
    expect(built.payload.documents.every((document) => document.checksum.length > 0)).toBe(true);
    expect(built.resolved).toHaveLength(built.payload.documents.length);
  });

  it('refuses to submit without every consent', async () => {
    const institution = await activePartner();
    const { program, intake } = await publishedProgramme(institution.id);
    await connectorFor(institution.id);
    const access = await student();
    await harness.students.patch(access, {
      dateOfBirth: '2002-04-01',
      nationality: 'NG',
      countryOfResidence: 'NG',
    });
    await uploadDocument(access);

    const created = await harness.applications.start(access, {
      programKey: program.programKey,
      intakeId: intake.id,
    });

    // One consent short. Not "mostly consented".
    await expect(
      harness.applications.recordConsents(access, created.id, ['university_submission']),
    ).rejects.toMatchObject({ code: 'consent_missing' });

    await harness.applications.markReady(access, created.id);
    await expect(harness.applications.submit(access, created.id)).rejects.toMatchObject({
      code: 'consent_missing',
    });
    expect(harness.connector.calls).toHaveLength(0);
  });

  it('refuses a partner whose connector is switched off', async () => {
    const institution = await activePartner();
    const { program, intake } = await publishedProgramme(institution.id);
    const connector = await connectorFor(institution.id);
    const access = await student();
    await harness.students.patch(access, { dateOfBirth: '2002-04-01', nationality: 'NG' });
    await uploadDocument(access);

    const created = await harness.applications.start(access, {
      programKey: program.programKey,
      intakeId: intake.id,
    });
    await harness.applications.recordConsents(
      access,
      created.id,
      SUBMISSION_CONSENTS.map((consent) => consent.id) as SubmissionConsentId[],
    );
    await harness.applications.markReady(access, created.id);

    await prisma.connectorConfig.update({ where: { id: connector.id }, data: { enabled: false } });
    await expect(harness.applications.submit(access, created.id)).rejects.toMatchObject({
      code: 'precondition_failed',
    });
    expect(harness.connector.calls).toHaveLength(0);
  });
});

describe('idempotency and retries', () => {
  it('sends the university one key for a submission, so a retry cannot duplicate it', async () => {
    // Acceptance criterion 3, at the layer that matters: the partner's own
    // duplicate guard.
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    expect(harness.connector.calls).toHaveLength(1);
    expect(harness.connector.calls[0]!.idempotencyKey).toBe(
      partnerIdempotencyKey(applicationId, 1),
    );
  });

  it('leaves a timed-out submission in submitted_pending and never says "Submitted"', async () => {
    // Acceptance criterion 4, and the chaos case in criterion 10.
    const { access, applicationId } = await readyApplication();
    harness.connector.outcomes = [
      { status: 'retryable_failure', reason: 'no response within 20s', retryAfterSeconds: null },
    ];

    const result = await harness.applications.submit(access, applicationId);

    expect(result.state).toBe('submitted_pending');
    expect(result.headline).toBe('Sending to University of Example');
    expect(result.headline).not.toContain('Submitted');
    expect(result.externalRef).toBeNull();

    const attempt = await prisma.submissionAttempt.findFirstOrThrow({ where: { applicationId } });
    expect(attempt.state).toBe('failed');
    expect(attempt.nextRetryAt).not.toBeNull();
    // A retry was scheduled rather than the failure being swallowed.
    expect(
      harness.queue.enqueued.some((job) => job.job === 'retry-submission'),
    ).toBe(true);
  });

  it('re-sends the same snapshot on a retry, under the same partner key', async () => {
    const { access, applicationId } = await readyApplication();
    harness.connector.outcomes = [
      { status: 'retryable_failure', reason: 'connection reset', retryAfterSeconds: null },
      { status: 'accepted', externalRef: 'UNI-REF-9', receivedAt: new Date().toISOString(), evidence: {} },
    ];

    await harness.applications.submit(access, applicationId);
    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({ where: { applicationId } });
    await harness.submissions.retry(applicationId, snapshot.id, 1, 2);

    expect(harness.connector.calls).toHaveLength(2);
    // Same key both times: the university sees one application, not two.
    expect(harness.connector.calls[0]!.idempotencyKey).toBe(
      harness.connector.calls[1]!.idempotencyKey,
    );
    // And still one snapshot — a retry does not rebuild the payload.
    expect(await prisma.applicationSnapshot.count({ where: { applicationId } })).toBe(1);

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('submitted');
    expect(stored.externalRef).toBe('UNI-REF-9');
  });

  it('makes a retry a no-op once the submission was already confirmed', async () => {
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);
    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({ where: { applicationId } });

    const result = await harness.submissions.retry(applicationId, snapshot.id, 1, 2);
    expect(result).toBeNull();
    expect(harness.connector.calls).toHaveLength(1);
  });

  it('dead-letters after the last attempt without ever claiming submission', async () => {
    const { access, applicationId } = await readyApplication();
    harness.connector.outcomes = [
      { status: 'retryable_failure', reason: 'no response', retryAfterSeconds: null },
    ];
    await harness.applications.submit(access, applicationId);
    const snapshot = await prisma.applicationSnapshot.findFirstOrThrow({ where: { applicationId } });

    for (let attempt = 2; attempt <= 6; attempt += 1) {
      await harness.submissions.retry(applicationId, snapshot.id, 1, attempt);
    }

    const last = await prisma.submissionAttempt.findFirstOrThrow({
      where: { applicationId },
      orderBy: { attemptNo: 'desc' },
    });
    expect(last.attemptNo).toBe(6);
    expect(last.state).toBe('dead_lettered');

    // Still `submitted_pending`, deliberately: after six timeouts we do not
    // know whether the university has it, and "failed" would be a claim we
    // cannot support either.
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('submitted_pending');
    expect(stored.externalRef).toBeNull();

    const opsTask = await prisma.applicationTask.findFirstOrThrow({
      where: { applicationId, owner: 'modex_ops' },
    });
    expect(opsTask.title).toContain('stuck');
  });

  it('moves to failed with an actionable reason when the university says no', async () => {
    const { access, applicationId } = await readyApplication();
    harness.connector.outcomes = [
      {
        status: 'rejected',
        code: 'missing_transcript',
        message: 'No transcript was supplied.',
        fieldErrors: [],
      },
    ];

    const result = await harness.applications.submit(access, applicationId);
    expect(result.state).toBe('failed');
    expect(result.headline).toBe('Submission failed');

    const task = await prisma.applicationTask.findFirstOrThrow({
      where: { applicationId, owner: 'student' },
    });
    expect(task.detail).toContain('No transcript was supplied.');

    // A rejection is a verdict: no retry is scheduled for it.
    expect(harness.queue.enqueued.some((job) => job.job === 'retry-submission')).toBe(false);
  });

  it('builds a new snapshot, and a new partner key, for a genuine resubmission', async () => {
    const { access, applicationId } = await readyApplication();
    harness.connector.outcomes = [
      { status: 'rejected', code: 'x', message: 'Fix it.', fieldErrors: [] },
      { status: 'accepted', externalRef: 'UNI-REF-2', receivedAt: new Date().toISOString(), evidence: {} },
    ];

    await harness.applications.submit(access, applicationId);
    await harness.applications.markReady(access, applicationId);
    await harness.applications.submit(access, applicationId);

    expect(await prisma.applicationSnapshot.count({ where: { applicationId } })).toBe(2);
    expect(harness.connector.calls[0]!.idempotencyKey).not.toBe(
      harness.connector.calls[1]!.idempotencyKey,
    );
  });
});

describe('re-validation at the submission boundary', () => {
  it('blocks and explains when a requirement changed since the student started', async () => {
    // Acceptance criterion 7.
    const { access, applicationId, program } = await readyApplication();

    const current = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey, effectiveTo: null },
    });
    await prisma.requirement.create({
      data: {
        programId: current.id,
        ruleType: 'portfolio',
        ruleJson: { type: 'portfolio', required: true },
        humanSummary: 'A portfolio of recent work is now required.',
        sourceRef: 'https://example.ac.uk/entry',
      },
    });

    await expect(harness.applications.submit(access, applicationId)).rejects.toMatchObject({
      code: 'precondition_failed',
    });

    // Nothing left the building.
    expect(harness.connector.calls).toHaveLength(0);
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('ready');

    try {
      await harness.applications.submit(access, applicationId);
    } catch (error) {
      const details = (error as AppError).details as {
        requirementChanges: { kind: string; explanation: string }[];
      };
      expect(details.requirementChanges).toHaveLength(1);
      expect(details.requirementChanges[0]!.kind).toBe('added');
      // Specific and actionable, not "something changed".
      expect(details.requirementChanges[0]!.explanation).toContain('portfolio');
    }
  });

  it('lets the submission through once the student has seen the change', async () => {
    const { access, applicationId, program } = await readyApplication();
    const current = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey, effectiveTo: null },
    });
    await prisma.requirement.create({
      data: {
        programId: current.id,
        ruleType: 'interview',
        ruleJson: { type: 'interview', required: true },
        humanSummary: 'An interview is now required.',
        sourceRef: 'https://example.ac.uk/entry',
      },
    });

    await expect(harness.applications.submit(access, applicationId)).rejects.toBeInstanceOf(AppError);
    // Re-acknowledging is what `markReady` does, and it is the student's act.
    await harness.applications.markReady(access, applicationId);
    const result = await harness.applications.submit(access, applicationId);
    expect(result.state).toBe('submitted');
  });
});

describe('inbound status events', () => {
  async function submitted() {
    const fixture = await readyApplication();
    await harness.applications.submit(fixture.access, fixture.applicationId);
    return fixture;
  }

  function signed(connectorId: string, body: unknown, at = new Date()) {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(at.getTime() / 1000));
    return {
      raw,
      timestamp,
      signature: signWebhook(`secret-for-partner-webhook`, timestamp, raw),
    };
  }

  it('applies a signed status event and records it', async () => {
    const { connector, applicationId } = await submitted();
    const event = signed(connector.id, {
      providerEventId: 'evt_1',
      externalRef: 'UNI-REF-1',
      kind: 'under_review',
      occurredAt: new Date().toISOString(),
    });

    const result = await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });
    expect(result).toMatchObject({ accepted: true, applied: true });

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('under_review');
  });

  it('refuses a bad signature and audits the refusal', async () => {
    const { connector } = await submitted();
    const event = signed(connector.id, {
      providerEventId: 'evt_2',
      externalRef: 'UNI-REF-1',
      kind: 'offer_made',
      occurredAt: new Date().toISOString(),
    });

    await expect(
      harness.inbound.receiveSigned(connector.id, event.raw, {
        signature: 'f'.repeat(64),
        timestamp: event.timestamp,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const trail = await harness.audit.trailFor('connector', connector.id);
    expect(trail.some((entry) => entry.action === 'connector.event_rejected')).toBe(true);
    // Nothing was stored from an unverified body.
    expect(await prisma.applicationStatusEvent.count()).toBe(0);
  });

  it('refuses a replay from outside the signing window', async () => {
    const { connector } = await submitted();
    const old = new Date(Date.now() - 60 * 60_000);
    const event = signed(connector.id, {
      providerEventId: 'evt_3',
      externalRef: 'UNI-REF-1',
      kind: 'offer_made',
      occurredAt: old.toISOString(),
    }, old);

    await expect(
      harness.inbound.receiveSigned(connector.id, event.raw, {
        signature: event.signature,
        timestamp: event.timestamp,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('applies a duplicate delivery exactly once', async () => {
    const { connector, applicationId } = await submitted();
    const body = {
      providerEventId: 'evt_4',
      externalRef: 'UNI-REF-1',
      kind: 'offer_made' as const,
      occurredAt: new Date().toISOString(),
    };
    const event = signed(connector.id, body);

    const first = await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });
    const second = await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('duplicate event');
    expect(await prisma.applicationStatusEvent.count({ where: { applicationId } })).toBe(1);
  });

  it('keeps an event that changed nothing, and says why', async () => {
    // "Keep all inbound status events" — a student disputing a decision needs
    // the whole sequence, not the subset we acted on.
    const { connector, applicationId } = await submitted();
    const body = {
      providerEventId: 'evt_5',
      externalRef: 'UNI-REF-1',
      kind: 'enrolled' as const,
      occurredAt: new Date().toISOString(),
    };
    const event = signed(connector.id, body);

    const result = await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });

    expect(result).toMatchObject({ accepted: true, applied: false });
    const stored = await prisma.applicationStatusEvent.findFirstOrThrow({
      where: { applicationId },
    });
    expect(stored.applied).toBe(false);
    expect(stored.skippedReason).toContain('cannot go from submitted to enrolled');
  });

  it('stores an event for a reference nobody holds rather than dropping it', async () => {
    const { connector } = await submitted();
    const event = signed(connector.id, {
      providerEventId: 'evt_6',
      externalRef: 'SOMEONE-ELSES-REF',
      kind: 'offer_made',
      occurredAt: new Date().toISOString(),
    });

    const result = await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });
    expect(result.applied).toBe(false);
    const stored = await prisma.applicationStatusEvent.findFirstOrThrow({
      where: { providerEventId: 'evt_6' },
    });
    expect(stored.applicationId).toBeNull();
    expect(stored.skippedReason).toContain('no application carries this reference');
  });

  it('confirms a handoff submission through the same inbound path', async () => {
    // The connector shape that cannot confirm synchronously: the receipt
    // arrives later, and it is what moves the application to `submitted`.
    const { access, applicationId, connector } = await readyApplication();
    harness.connector.outcomes = [
      {
        status: 'handoff_required',
        continuationUrl: 'https://partner.example/portal?ref=hof_1',
        handoffRef: 'hof_1',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    ];

    const result = await harness.applications.submit(access, applicationId);
    expect(result.state).toBe('submitted_pending');
    expect(result.continuation?.url).toContain('partner.example');

    // No reference, so no claim of submission — and nothing to receive an
    // event against yet, which is the honest shape of a handoff.
    const pending = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(pending.externalRef).toBeNull();

    // The partner quotes back the token we put in their continuation URL,
    // because their own reference is what this very event is telling us.
    const event = signed(connector.id, {
      providerEventId: 'evt_7',
      externalRef: 'PORTAL-REF-1',
      modexRef: 'hof_1',
      kind: 'received',
      occurredAt: new Date().toISOString(),
    });
    await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });

    const confirmed = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(confirmed.state).toBe('submitted');
    expect(confirmed.confirmedAt).not.toBeNull();
    // The university's own reference, learned from the event that confirmed it.
    expect(confirmed.externalRef).toBe('PORTAL-REF-1');
  });

  it('opens a student task when the university asks for more information', async () => {
    const { connector, applicationId } = await submitted();
    // The TRD reaches `more_info` from `under_review`, so the university moves
    // the application into review first. An out-of-order event is stored with
    // its reason rather than acted on — see the test below.
    const review = signed(connector.id, {
      providerEventId: 'evt_8a',
      externalRef: 'UNI-REF-1',
      kind: 'under_review',
      occurredAt: new Date().toISOString(),
    });
    await harness.inbound.receiveSigned(connector.id, review.raw, {
      signature: review.signature,
      timestamp: review.timestamp,
    });

    const event = signed(connector.id, {
      providerEventId: 'evt_8',
      externalRef: 'UNI-REF-1',
      kind: 'more_info_required',
      occurredAt: new Date().toISOString(),
      detail: { message: 'Please send a certified translation of your transcript.' },
    });
    await harness.inbound.receiveSigned(connector.id, event.raw, {
      signature: event.signature,
      timestamp: event.timestamp,
    });

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.state).toBe('more_info');
    expect(stored.currentOwner).toBe('student');

    const task = await prisma.applicationTask.findFirstOrThrow({
      where: { applicationId, type: 'provide_more_info' },
    });
    // The partner's own words, not ours.
    expect(task.detail).toBe('Please send a certified translation of your transcript.');
  });
});

describe('the status poll', () => {
  it('respects each partner’s own rate limit', async () => {
    const { access, applicationId, connector } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    harness.connector.polled = [
      {
        providerEventId: 'poll_1',
        externalRef: 'UNI-REF-1',
        kind: 'under_review',
        occurredAt: new Date().toISOString(),
        detail: {},
      },
    ];

    const first = await harness.poll.sweep();
    expect(first.applied).toBe(1);

    // Immediately again: the partner asked for 900 seconds between calls.
    const second = await harness.poll.sweep();
    expect(second.polled).toBe(0);

    // And once the interval has passed, it polls again.
    const later = new Date(Date.now() + 1000 * 1000);
    harness.connector.polled = [];
    const third = await harness.poll.sweep(later);
    expect(third.polled).toBe(1);

    const stored = await prisma.connectorConfig.findUniqueOrThrow({ where: { id: connector.id } });
    expect(stored.lastPolledAt).not.toBeNull();
  });
});

describe('the correlation trace', () => {
  it('retrieves the full trace for a submission, click to external call', async () => {
    // Acceptance criterion 11.
    const { access, applicationId } = await readyApplication();
    await harness.applications.submit(access, applicationId);

    const trace = await harness.applications.trace(access, applicationId);

    expect(trace.state).toBe('submitted');
    expect(trace.attempts).toHaveLength(1);
    expect(trace.attempts[0]!.externalRef).toBe('UNI-REF-1');
    expect(trace.correlationIds).toHaveLength(1);

    const actions = trace.events.map((event) => event.action);
    expect(actions).toContain('application.created');
    expect(actions).toContain('application.snapshot_created');
    expect(actions).toContain('application.submission_attempted');
    expect(actions).toContain('application.submitted');
    // Every event carries its hash-chain link, so the trace is not merely a
    // list somebody could have appended to.
    expect(trace.events.every((event) => event.integrityRef.length > 0)).toBe(true);
  });

  it('does not let one student read another’s application', async () => {
    const { applicationId } = await readyApplication();
    const other = await student('bob@example.com');

    await expect(harness.applications.detail(other, applicationId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(harness.applications.trace(other, applicationId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('operator-assisted submission', () => {
  it('records who submitted, and the disclosure is permanent', async () => {
    const { access, applicationId } = await readyApplication();
    const operator = await prisma.user.create({
      data: { email: 'sam@modex.example', displayName: 'Sam Okafor', status: 'active' },
    });
    const opsAccess = buildAccessContext({
      sessionId: 'session_test',
      userId: operator.id,
      roles: ['ops'],
      organisationId: null,
      mfaSatisfied: true,
      consents: [],
    });

    await harness.applications.submit(opsAccess, applicationId, { operatorFor: access.userId });

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.operatorSubmittedById).toBe(operator.id);
    expect(stored.operatorSubmittedAt).not.toBeNull();

    const detail = await harness.applications.detail(access, applicationId);
    expect(detail.operatorDisclosure).toMatchObject({
      submittedBy: 'Sam Okafor',
      permanent: true,
    });

    const trail = await harness.audit.trailFor('application', applicationId);
    expect(trail.some((event) => event.action === 'application.operator_submitted')).toBe(true);
  });

  it('is not a route a student can take on their own application', async () => {
    const { access, applicationId } = await readyApplication();
    await expect(
      harness.applications.submit(access, applicationId, { operatorFor: access.userId }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses when the operator names the wrong student', async () => {
    // The disclosure says who submitted this and for whom. Accepting the name
    // without checking it would make the second half a claim nobody verified.
    const { applicationId } = await readyApplication();
    const someoneElse = await student('carol@example.com');
    const operator = await prisma.user.create({
      data: { email: 'ops@modex.example', displayName: 'Ops', status: 'active' },
    });
    const opsAccess = buildAccessContext({
      sessionId: 'session_test',
      userId: operator.id,
      roles: ['ops'],
      organisationId: null,
      mfaSatisfied: true,
      consents: [],
    });

    await expect(
      harness.applications.submit(opsAccess, applicationId, { operatorFor: someoneElse.userId }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(harness.connector.calls).toHaveLength(0);
  });
});
