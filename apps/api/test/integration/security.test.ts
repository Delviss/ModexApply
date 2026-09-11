import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  ProgramSearchQuerySchema,
  scanMessage,
  WEBHOOK_TOLERANCE_SECONDS,
} from '@modex/contracts';
import { signWebhook } from '../../src/common/crypto/webhook-signature.js';
import { SessionResolver } from '../../src/auth/session-resolver.js';
import { TokenService } from '../../src/auth/token.service.js';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  studentActor,
  trustAgent,
  universityStaff,
  type Harness,
} from './harness.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

/**
 * The Phase 7 security surface (TRD §23), as tests.
 *
 * Everything here is written as an attack rather than as a feature: each case
 * is something somebody would actually try, and the assertion is that it
 * fails. That framing matters — a test called "documents are owner-scoped"
 * passes the day somebody adds an endpoint that forgets to scope, because the
 * test was never about the endpoint. A test called "another student cannot read
 * my passport" does not.
 *
 * What is deliberately *not* here: a test that the signed URL expires, which
 * belongs to the storage adapter's own suite, and anything needing a browser,
 * which lives in `apps/web/test/e2e-journeys.mjs`.
 */
const SIGNING_KEY = 'test-signing-key-at-least-32-characters-long';
const YEAR = 365 * 24 * 60 * 60 * 1000;

let prisma: PrismaClient;
let harness: Harness;
let tokens: TokenService;
let resolver: SessionResolver;

beforeAll(async () => {
  prisma = createPrisma();
  await prisma.$connect();
  harness = createHarness(prisma);
  tokens = new TokenService(SIGNING_KEY, 900, 86_400);
  resolver = new SessionResolver(prisma as unknown as PrismaService, tokens);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  harness.queue.clear();
});

async function institution(displayName = 'University of Example', domain = 'example.ac.uk') {
  return prisma.institution.create({
    data: {
      legalName: `${displayName} Ltd`,
      displayName,
      domains: [domain],
      country: 'GB',
      verificationState: 'verified',
      verificationStage: 'active',
      partnerships: {
        create: {
          status: 'active',
          contractRef: 'contract://2026/example.pdf',
          startDate: new Date(Date.now() - YEAR),
          scopes: ['catalogue_publish', 'direct_application', 'guide_programme'],
        },
      },
    },
  });
}

async function student(email: string) {
  const user = await prisma.user.create({
    data: { email, displayName: email.split('@')[0] ?? 'Student', status: 'active' },
  });
  await prisma.userRoleGrant.create({ data: { userId: user.id, role: 'student' } });
  return user;
}

// ---------------------------------------------------------------------------
// IDOR — one student must not reach another student's anything
// ---------------------------------------------------------------------------

describe('IDOR', () => {
  it('refuses another student’s document, by id', async () => {
    const ada = await student('ada@example.com');
    const bilal = await student('bilal@example.com');

    const created = await harness.documents.createVersion(studentActor(ada.id), {
      type: 'passport',
      displayName: 'Passport',
      contentType: 'application/pdf',
      sizeBytes: 1_024,
    });

    // Knowing the id is the whole premise of the attack: it is not a secret,
    // and the refusal must not depend on it being one.
    await expect(
      harness.documents.signDownload(studentActor(bilal.id), created.version.id),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      harness.documents.remove(studentActor(bilal.id), created.document.id),
    ).rejects.toBeInstanceOf(AppError);

    const theirList = await harness.documents.list(studentActor(bilal.id));
    expect(theirList).toHaveLength(0);
  });

  it('refuses another student’s application and its snapshot', async () => {
    const partner = await institution();
    const ada = await student('ada2@example.com');
    const bilal = await student('bilal2@example.com');

    const program = await harness.catalogue.createProgram(opsUser(), partner.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    const intake = await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date(Date.now() + YEAR),
      applicationDeadline: new Date(Date.now() + YEAR / 2),
    });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    const application = await harness.applications.start(studentActor(ada.id), {
      programKey: program.programKey,
      intakeId: intake.id,
    });

    await expect(
      harness.applications.detail(studentActor(bilal.id), application.id),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('refuses another student’s conversation, and does not leak its existence', async () => {
    const partner = await institution();
    const ada = await student('ada3@example.com');
    const bilal = await student('bilal3@example.com');
    const guideUser = await prisma.user.create({
      data: { email: 'guide3@example.ac.uk', displayName: 'Guide', status: 'active' },
    });
    const guide = await prisma.studentGuide.create({
      data: {
        userId: guideUser.id,
        institutionId: partner.id,
        state: 'active',
        stage: 'active',
        verifiedAt: new Date(),
        evidenceExpiresAt: new Date(Date.now() + YEAR),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { studentId: ada.id, guideId: guide.id, status: 'open', contextType: 'general' },
    });

    await expect(
      harness.messaging.thread(studentActor(bilal.id), conversation.id),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      harness.messaging.send(studentActor(bilal.id), conversation.id, 'Hello?'),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('refuses another institution’s applications from the portal', async () => {
    const mine = await institution('Mine', 'mine.ac.uk');
    const theirs = await institution('Theirs', 'theirs.ac.uk');
    await expect(
      harness.portal.applications(universityStaff(mine.id), { institutionId: theirs.id }),
    ).rejects.toMatchObject({ code: 'organisation_boundary' });
  });
});

// ---------------------------------------------------------------------------
// Authentication bypass
// ---------------------------------------------------------------------------

describe('auth bypass', () => {
  async function sessionFor(userId: string) {
    const refresh = tokens.mintRefreshToken();
    return prisma.session.create({
      data: {
        userId,
        refreshTokenHash: refresh.hash,
        familyId: 'family-1',
        expiresAt: refresh.expiresAt,
        mfaSatisfied: true,
      },
    });
  }

  it('rejects a token signed with another key', async () => {
    const ada = await student('ada4@example.com');
    const session = await sessionFor(ada.id);

    const forged = await new SignJWT({ roles: ['superadmin'], mfa: true, sid: session.id })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(ada.id)
      .setIssuer('modex-apply')
      .setAudience('modex-apply-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('an-attackers-key-also-32-characters-long'));

    await expect(resolver.resolve(forged)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a token whose roles were rewritten', async () => {
    const ada = await student('ada5@example.com');
    const session = await sessionFor(ada.id);

    // Correctly signed, but claiming a role the database never granted. The
    // resolver re-reads roles from `user_role_grants` rather than trusting the
    // claim, so the escalation evaporates.
    const token = await tokens.issueAccessToken({
      sub: ada.id,
      roles: ['superadmin'],
      organisationId: null,
      mfa: true,
      sid: session.id,
    });

    const access = await resolver.resolve(token);
    expect(access.roles).toEqual(['student']);
    expect(access.permissions.has('trust_case:read')).toBe(false);
  });

  it('rejects a revoked session immediately, not at token expiry', async () => {
    const ada = await student('ada6@example.com');
    const session = await sessionFor(ada.id);
    const token = await tokens.issueAccessToken({
      sub: ada.id,
      roles: ['student'],
      organisationId: null,
      mfa: true,
      sid: session.id,
    });

    await expect(resolver.resolve(token)).resolves.toBeDefined();
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(resolver.resolve(token)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a session whose account was suspended', async () => {
    const ada = await student('ada7@example.com');
    const session = await sessionFor(ada.id);
    const token = await tokens.issueAccessToken({
      sub: ada.id,
      roles: ['student'],
      organisationId: null,
      mfa: true,
      sid: session.id,
    });

    await prisma.user.update({ where: { id: ada.id }, data: { status: 'suspended' } });
    await expect(resolver.resolve(token)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an expired token', async () => {
    const ada = await student('ada8@example.com');
    const session = await sessionFor(ada.id);
    const expired = new TokenService(SIGNING_KEY, -60, 86_400);
    const token = await expired.issueAccessToken({
      sub: ada.id,
      roles: ['student'],
      organisationId: null,
      mfa: true,
      sid: session.id,
    });
    await expect(resolver.resolve(token)).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('rejects an impersonation token once the grant is closed', async () => {
    const ada = await student('ada9@example.com');
    await prisma.consentGrant.create({
      data: { userId: ada.id, scope: 'support_access', noticeVersion: 'v1' },
    });

    const started = await harness.impersonation.start(opsUser('operator-1'), {
      subjectId: ada.id,
      reason: 'Student reported a stuck application in ticket 99.',
      reference: 'TICKET-99',
      minutes: 10,
    });

    // A token minted by *this* harness's signer, so the resolver can read it.
    const session = await prisma.session.findFirstOrThrow({
      where: { familyId: started.grantId },
    });
    const token = await tokens.issueAccessToken({
      sub: ada.id,
      roles: ['student'],
      organisationId: null,
      mfa: true,
      sid: session.id,
      act: 'operator-1',
    });

    const during = await resolver.resolve(token);
    expect(during.impersonatedBy).toBe('operator-1');

    await harness.impersonation.end(opsUser('operator-1'), started.grantId, 'Done.');
    await expect(resolver.resolve(token)).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

describe('injection', () => {
  it('treats SQL metacharacters in a search query as text', async () => {
    const partner = await institution();
    const program = await harness.catalogue.createProgram(opsUser(), partner.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date(Date.now() + YEAR),
      applicationDeadline: new Date(Date.now() + YEAR / 2),
    });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);
    await harness.indexer.reindexProgram(program.programKey);

    const attacks = [
      "'; DROP TABLE programs; --",
      "' OR 1=1 --",
      'x\\0y',
      '%%%',
      '\\',
      '"; SELECT pg_sleep(10); --',
    ];

    for (const attack of attacks) {
      const query = ProgramSearchQuerySchema.parse({ q: attack });
      const result = await harness.search.search(query, null);
      expect(Array.isArray(result.results)).toBe(true);
    }

    // The table is still there, which is the actual assertion.
    expect(await prisma.program.count()).toBeGreaterThan(0);
  });

  it('stores a programme name containing SQL as a name', async () => {
    const partner = await institution();
    const nasty = "MSc '); DELETE FROM users; --";
    const program = await harness.catalogue.createProgram(opsUser(), partner.id, {
      name: nasty,
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    const stored = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey },
    });
    expect(stored.name).toBe(nasty);
    expect(await prisma.user.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// File upload abuse
// ---------------------------------------------------------------------------

describe('file upload abuse', () => {
  it('never lets a client choose the object key', async () => {
    const ada = await student('ada10@example.com');
    const created = await harness.documents.createVersion(studentActor(ada.id), {
      type: 'passport',
      displayName: '../../etc/passwd',
      contentType: 'application/pdf',
      sizeBytes: 1_024,
    });

    // The display name is the student's; the key is ours. Path traversal in a
    // file name therefore cannot become path traversal in storage — and the
    // owner segment is hashed rather than the raw user id, so an object key
    // leaking from a log or a CDN path does not also leak who it belongs to.
    expect(created.version.objectKey).not.toContain('..');
    expect(created.version.objectKey).not.toContain('etc/passwd');
    expect(created.version.objectKey.startsWith('documents/')).toBe(true);
    expect(created.version.objectKey).not.toContain(ada.id);
  });

  it('keeps an unscanned version out of every downstream use', async () => {
    const ada = await student('ada11@example.com');
    const created = await harness.documents.createVersion(studentActor(ada.id), {
      type: 'passport',
      displayName: 'Passport',
      contentType: 'application/pdf',
      sizeBytes: 1_024,
    });
    expect(created.version.scanState).toBe('pending');

    const usable = await harness.documents.list(studentActor(ada.id));
    expect(usable.every((document) => document.usable !== true)).toBe(true);
  });

  it('quarantines an infected version and refuses to sign a download for it', async () => {
    const ada = await student('ada12@example.com');
    const created = await harness.documents.createVersion(studentActor(ada.id), {
      type: 'passport',
      displayName: 'Passport',
      contentType: 'application/pdf',
      sizeBytes: 1_024,
    });
    // The EICAR test string: what a scanner is *supposed* to flag, and the only
    // safe way to exercise this path without a real sample.
    const bytes = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    harness.storage.put(created.version.objectKey, bytes);
    harness.scanner.verdict = { state: 'quarantined', detail: 'EICAR test signature' };
    await harness.documents.finalise(studentActor(ada.id), created.version.id, {
      checksum: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
    });
    await harness.documents.runScan(created.version.id);

    const version = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(version.scanState).toBe('quarantined');

    await expect(
      harness.documents.signDownload(studentActor(ada.id), created.version.id),
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// Webhook replay and forgery
// ---------------------------------------------------------------------------

describe('inbound webhooks', () => {
  async function connector() {
    const partner = await institution();
    return prisma.connectorConfig.create({
      data: {
        institutionId: partner.id,
        type: 'api',
        displayName: 'Example direct API',
        endpointUrl: 'https://partner.example.ac.uk/applications',
        credentialRef: 'example-api',
        signingSecretRef: 'example-webhook',
        enabled: true,
      },
    });
  }

  const event = (providerEventId: string) =>
    JSON.stringify({
      providerEventId,
      externalRef: 'PARTNER-REF-1',
      kind: 'received',
      occurredAt: new Date().toISOString(),
    });

  it('rejects an unsigned event', async () => {
    const config = await connector();
    await expect(
      harness.inbound.receiveSigned(config.id, event('evt-1'), {
        signature: undefined,
        timestamp: undefined,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a forged signature', async () => {
    const config = await connector();
    const body = event('evt-2');
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      harness.inbound.receiveSigned(config.id, body, {
        signature: signWebhook('not-the-secret', timestamp, body),
        timestamp,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a replay of a signature outside the tolerance window', async () => {
    const config = await connector();
    const body = event('evt-3');
    const secret = harness.secrets.resolve('example-webhook') ?? '';
    const stale = String(Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 60);

    await expect(
      harness.inbound.receiveSigned(config.id, body, {
        signature: signWebhook(secret, stale, body),
        timestamp: stale,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('accepts an event once and ignores the replay', async () => {
    const config = await connector();
    const body = event('evt-4');
    const secret = harness.secrets.resolve('example-webhook') ?? '';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { signature: signWebhook(secret, timestamp, body), timestamp };

    const first = await harness.inbound.receiveSigned(config.id, body, headers);
    const second = await harness.inbound.receiveSigned(config.id, body, headers);

    expect(first.accepted).toBe(true);
    // The same provider event id twice is one event. The unique constraint on
    // (connectorId, providerEventId) is what makes that true even under a race,
    // and the second call is accepted-but-not-applied rather than an error: a
    // partner retrying after a timeout has done nothing wrong.
    expect(second.applied).toBe(false);
    expect(second.reason).toBeTruthy();
    expect(
      await prisma.applicationStatusEvent.count({ where: { providerEventId: 'evt-4' } }),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fraud scenarios (TRD §23)
// ---------------------------------------------------------------------------

describe('fraud scenarios', () => {
  const scenarios = [
    {
      name: 'off-platform payment solicitation',
      body: 'Send the deposit to my Revolut account and I will secure your place.',
      sender: 'guide' as const,
      signal: 'payment_solicitation',
    },
    {
      name: 'guaranteed admission claim',
      body: 'I can guarantee admission, 100% acceptance, no rejections.',
      sender: 'guide' as const,
      signal: 'guarantee_claim',
    },
    {
      name: 'impersonating admissions staff',
      body: 'I am an admissions officer here and I decide who gets in.',
      sender: 'guide' as const,
      signal: 'impersonation',
    },
    {
      name: 'moving the conversation off-platform',
      body: 'Message me on WhatsApp, my number is +44 7700 900123.',
      sender: 'guide' as const,
      signal: 'off_platform_solicitation',
    },
  ];

  for (const scenario of scenarios) {
    it(`catches ${scenario.name}`, () => {
      const assessment = scanMessage(scenario.body, scenario.sender);
      expect(assessment.findings.map((finding) => finding.signal)).toContain(scenario.signal);
      expect(assessment.action).toBe('warn_and_open_case');
    });
  }

  it('catches evasion by spacing and character substitution', () => {
    const assessment = scanMessage('s e n d  t h e  m o n e y  to my b4nk', 'guide');
    expect(assessment.findings.length).toBeGreaterThan(0);
  });

  it('opens a trust case and preserves the message as evidence', async () => {
    const partner = await institution();
    const ada = await student('ada13@example.com');
    const guideUser = await prisma.user.create({
      data: { email: 'scammer@example.ac.uk', displayName: 'Guide', status: 'active' },
    });
    await prisma.userRoleGrant.create({ data: { userId: guideUser.id, role: 'guide' } });
    const guide = await prisma.studentGuide.create({
      data: {
        userId: guideUser.id,
        institutionId: partner.id,
        state: 'active',
        stage: 'active',
        verifiedAt: new Date(),
        evidenceExpiresAt: new Date(Date.now() + YEAR),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { studentId: ada.id, guideId: guide.id, status: 'open', contextType: 'general' },
    });

    await harness.messaging.send(
      { ...studentActor(guideUser.id), roles: ['guide'] },
      conversation.id,
      'Pay me the admission fee of 500 and your place is guaranteed.',
    );

    const flags = await prisma.messageFlag.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    expect(flags.length).toBeGreaterThan(0);

    const cases = await prisma.trustCase.findMany({ where: { targetId: guide.id } });
    expect(cases.length).toBeGreaterThan(0);

    // Evidence outlives moderation: the snapshot is in a table with no delete
    // path, and it is not the message row.
    await expect(
      prisma.messageFlag.deleteMany({ where: { id: flags[0]?.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('suspends a guide who demands payment, without a human step', async () => {
    const partner = await institution();
    const ada = await student('ada14@example.com');
    const guideUser = await prisma.user.create({
      data: { email: 'scammer2@example.ac.uk', displayName: 'Guide', status: 'active' },
    });
    await prisma.userRoleGrant.create({ data: { userId: guideUser.id, role: 'guide' } });
    const guide = await prisma.studentGuide.create({
      data: {
        userId: guideUser.id,
        institutionId: partner.id,
        state: 'active',
        stage: 'active',
        verifiedAt: new Date(),
        evidenceExpiresAt: new Date(Date.now() + YEAR),
      },
    });
    const conversation = await prisma.conversation.create({
      data: { studentId: ada.id, guideId: guide.id, status: 'open', contextType: 'general' },
    });

    await harness.messaging.send(
      { ...studentActor(guideUser.id), roles: ['guide'] },
      conversation.id,
      'Transfer the money to my IBAN GB29 and I will handle your admission.',
    );

    const after = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(after.state).toBe('suspended');
  });
});

// ---------------------------------------------------------------------------
// Logs and audit hygiene
// ---------------------------------------------------------------------------

describe('logging hygiene', () => {
  it('never writes a secret into an audit event', async () => {
    await harness.audit.record({
      actor: { id: 'user-1', type: 'user', roles: ['ops'], organisationId: null, mfaSatisfied: true },
      action: 'connector.event_received',
      objectType: 'connector',
      objectId: 'connector-1',
      metadata: {
        signingSecret: 'super-secret-value',
        nested: { accessToken: 'another-secret', fine: 'kept' },
      },
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      orderBy: { timestamp: 'desc' },
    });
    const metadata = event.metadata as Record<string, unknown>;
    expect(metadata.signingSecret).toBe('[redacted]');
    expect((metadata.nested as Record<string, unknown>).accessToken).toBe('[redacted]');
    expect((metadata.nested as Record<string, unknown>).fine).toBe('kept');
  });

  it('has no delete path for the audit trail, for any role', async () => {
    await harness.audit.record({
      actor: { id: null, type: 'system', roles: [], organisationId: null, mfaSatisfied: false },
      action: 'trust_case.opened',
      objectType: 'trust_case',
      objectId: 'case-1',
    });
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });
});

describe('trust console permissions', () => {
  it('refuses a student the trust queue', async () => {
    const ada = await student('ada15@example.com');
    const access = studentActor(ada.id);
    expect(access.permissions.has('trust_case:read')).toBe(false);
    expect(access.permissions.has('evidence:read')).toBe(false);
  });

  it('gives trust no impersonation permission', () => {
    // An investigator who can *become* the person they are investigating has
    // contaminated their own evidence.
    expect(trustAgent().permissions.has('user:impersonate')).toBe(false);
    expect(opsUser().permissions.has('user:impersonate')).toBe(true);
  });
});
