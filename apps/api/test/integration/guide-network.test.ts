import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toAuditActor } from '../../src/auth/audit-actor.js';
import { systemActor } from '../../src/auth/audit-actor.js';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  createHarness,
  createPrisma,
  guideAccessConsent,
  guideActor,
  opsUser,
  resetDatabase,
  studentActor,
  trustAgent,
  type Harness,
} from './harness.js';
import {
  GUIDE_EVIDENCE_VALIDITY_DAYS,
  GUIDE_EXPIRY_WARNING_DAYS,
  GUIDE_SUSPENSION_GRACE_DAYS,
  PRIVATE_GUIDE_KEYS,
} from '@modex/contracts';

/**
 * Phase 3 end to end, against a real PostgreSQL.
 *
 * These are the acceptance criteria from issue #5, in order, because every one
 * of them is a claim about behaviour under a real database: an append-only
 * trigger, a transaction that suspends a guide and tells their students in the
 * same breath, a slot that two students cannot both book.
 */
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
});

const DOMAIN = 'example.ac.uk';

/** An institution walked to an active partnership that runs a guide programme. */
async function partnerRunningGuides() {
  const institution = await harness.institutions.create(opsUser(), {
    legalName: 'The University of Example',
    displayName: 'University of Example',
    domains: [DOMAIN],
    country: 'GB',
  });
  const agent = trustAgent();

  await harness.institutions.recordEvidence(agent, institution.id, {
    stage: 'legal_entity_check',
    summary: 'Companies House record confirmed.',
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'legal_entity_check');

  const challenge = await harness.domains.issueChallenge(toAuditActor(agent), institution.id, DOMAIN);
  harness.dns.publish(`_modex-challenge.${DOMAIN}`, challenge.recordValue);
  await harness.domains.checkChallenge(toAuditActor(agent), challenge.id);
  await harness.institutions.advanceVerification(agent, institution.id, 'official_domain_confirmation');

  const contact = await harness.institutions.addContact(opsUser(), institution.id, {
    fullName: 'R. Adeyemi',
    email: `registrar@${DOMAIN}`,
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
    // The scope is what makes a guide programme exist at this university at all.
    scopes: ['catalogue_publish', 'direct_application', 'guide_programme'],
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'signed_contract');
  await harness.institutions.advanceVerification(agent, institution.id, 'active');

  return institution;
}

/** A guide, verified as far as the caller asks for. */
async function makeGuide(
  institutionId: string,
  options: {
    email?: string;
    displayName?: string;
    verified?: boolean;
    languages?: string[];
    topics?: ('accommodation' | 'cost_of_living' | 'campus_life')[];
    homeCountry?: string | null;
  } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: options.email ?? `amara@${DOMAIN}`,
      displayName: options.displayName ?? 'Amara Chidinma Okonkwo',
      phone: '+44 7700 900123',
      status: 'active',
    },
  });
  const access = guideActor(user.id);
  await harness.guides.register(access, { institutionId });

  if (options.languages !== undefined || options.topics !== undefined || options.homeCountry !== undefined) {
    await harness.guides.updateProfile(access, {
      languages: options.languages ?? ['English'],
      topics: options.topics ?? ['accommodation'],
      homeCountry: options.homeCountry ?? 'NG',
      level: 'undergraduate',
      yearOfStudy: 2,
    });
  }

  const guide = await harness.guides.requireOwnGuide(access);

  if (options.verified !== false) {
    await prisma.guideVerification.create({
      data: {
        guideId: guide.id,
        evidenceType: 'student_id_document',
        summary: 'Student ID checked against the institution roster.',
        verifiedAt: new Date(),
        expiresAt: addDays(new Date(), GUIDE_EVIDENCE_VALIDITY_DAYS),
        reviewerId: 'user_trust',
      },
    });
    await harness.guides.verify(trustAgent(), guide.id);
  }

  return { user, access, guideId: guide.id };
}

async function makeStudent(email = 'ada@example.com') {
  const user = await prisma.user.create({
    data: { email, displayName: 'Ada Bello', status: 'active' },
  });
  return user;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

describe('a guide is always a link to current-student evidence', () => {
  it('refuses to activate a guide whose evidence is not on file', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id, { verified: false });

    await expect(harness.guides.verify(trustAgent(), guideId)).rejects.toThrow(AppError);
    const guide = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } });
    expect(guide.state).toBe('pending');
  });

  it('refuses registration at a university with no guide programme', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'No Guides University',
      displayName: 'No Guides University',
      domains: ['noguides.ac.uk'],
      country: 'GB',
    });
    const user = await prisma.user.create({
      data: { email: 'hopeful@noguides.ac.uk', displayName: 'Hopeful Guide', status: 'active' },
    });

    await expect(
      harness.guides.register(guideActor(user.id), { institutionId: institution.id }),
    ).rejects.toThrow(/guide programme/);
  });

  it('drops a guide back to pending when they change university', async () => {
    const institution = await partnerRunningGuides();
    const { access, guideId } = await makeGuide(institution.id);

    const other = await harness.institutions.create(opsUser(), {
      legalName: 'Another University',
      displayName: 'Another University',
      domains: ['another.ac.uk'],
      country: 'GB',
    });
    await harness.guides.updateProfile(access, { institutionId: other.id });

    const guide = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } });
    // Evidence proved they studied *there*. It proves nothing about here.
    expect(guide.state).toBe('pending');
    const changes = await prisma.guideIdentityChange.findMany({ where: { guideId } });
    expect(changes).toHaveLength(1);
  });
});

describe('acceptance 1 — a guide cannot message unless active', () => {
  it('refuses server-side for every state that is not active', async () => {
    const institution = await partnerRunningGuides();
    const { access: guide, guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const studentAccess = studentActor(student.id, guideAccessConsent(guideId));

    const opened = await harness.messaging.openConversation(studentAccess, { guideId });
    const conversationId = opened.conversation.id;

    // Active: fine.
    await expect(
      harness.messaging.send(guide, conversationId, 'Halls are about 140 a week.'),
    ).resolves.toBeTruthy();

    for (const state of ['pending', 'restricted', 'suspended', 'revoked'] as const) {
      await prisma.studentGuide.update({ where: { id: guideId }, data: { state } });
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'open' } });
      await expect(
        harness.messaging.send(guide, conversationId, 'Are you still there?'),
      ).rejects.toThrow(AppError);
    }
  });

  it('does not let a student open a conversation with a guide who is not active', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    await prisma.studentGuide.update({ where: { id: guideId }, data: { state: 'restricted' } });

    const student = await makeStudent();
    await expect(
      harness.messaging.openConversation(studentActor(student.id, guideAccessConsent(guideId)), {
        guideId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('needs the student’s guide_access consent, not just their session', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    const student = await makeStudent();

    await expect(
      harness.messaging.openConversation(studentActor(student.id), { guideId }),
    ).rejects.toThrow(/consent/i);
  });
});

describe('acceptance 2 — expiry notifies, restricts and suspends on its own', () => {
  it('walks the whole lifecycle with nothing but a clock', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const conversation = await harness.messaging.openConversation(
      studentActor(student.id, guideAccessConsent(guideId)),
      { guideId },
    );

    const expiresAt = (
      await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } })
    ).evidenceExpiresAt;
    if (expiresAt === null) throw new Error('The fixture should have set an expiry.');

    // 1. Comfortably inside the window: nothing happens.
    const quiet = await harness.reverification.sweep(addDays(expiresAt, -60));
    expect(quiet).toMatchObject({ notified: 0, restricted: 0, suspended: 0 });

    // 2. Inside the warning window: notified once, and only once.
    const warned = await harness.reverification.sweep(
      addDays(expiresAt, -(GUIDE_EXPIRY_WARNING_DAYS - 1)),
    );
    expect(warned.notified).toBe(1);
    const again = await harness.reverification.sweep(
      addDays(expiresAt, -(GUIDE_EXPIRY_WARNING_DAYS - 1)),
    );
    expect(again.notified).toBe(0);
    expect(
      harness.queue.enqueued.filter((job) => job.job === 'guide-reverification-due'),
    ).toHaveLength(1);

    // 3. Past expiry: restricted, and the student is told in the thread.
    const restricted = await harness.reverification.sweep(addDays(expiresAt, 1));
    expect(restricted.restricted).toBe(1);
    expect(
      (await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } })).state,
    ).toBe('restricted');
    const afterRestriction = await prisma.message.findMany({
      where: { conversationId: conversation.conversation.id, systemKind: 'guide_restricted' },
    });
    expect(afterRestriction).toHaveLength(1);
    // The conversation itself stays open: their history is not taken away.
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.conversation.id } }))
        .status,
    ).toBe('open');

    // 4. Past the grace period: suspended, with no human step anywhere above.
    const suspended = await harness.reverification.sweep(
      addDays(expiresAt, GUIDE_SUSPENSION_GRACE_DAYS + 1),
    );
    expect(suspended.suspended).toBe(1);
    const guide = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } });
    expect(guide.state).toBe('suspended');

    const events = await prisma.auditEvent.findMany({
      where: { objectType: 'guide', objectId: guideId },
      orderBy: { timestamp: 'asc' },
    });
    const actions = events.map((event) => event.action);
    expect(actions).toContain('guide.reverification_notified');
    expect(actions).toContain('guide.restricted');
    expect(actions).toContain('guide.suspended');
    // Every one of them written by the system, not by a person — which is the
    // acceptance criterion, stated as a property of the audit trail.
    const lifecycle = new Set([
      'guide.reverification_notified',
      'guide.restricted',
      'guide.suspended',
    ]);
    for (const event of events.filter((entry) => lifecycle.has(entry.action))) {
      expect(event.actorType).toBe('system');
      expect(event.actorId).toBeNull();
    }
  });

  it('reverifying clears the restriction', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    await prisma.studentGuide.update({
      where: { id: guideId },
      data: { state: 'restricted', evidenceExpiresAt: addDays(new Date(), -1) },
    });

    await prisma.guideVerification.create({
      data: {
        guideId,
        evidenceType: 'institution_roster',
        summary: 'Roster re-confirmed for the new term.',
        verifiedAt: new Date(),
        expiresAt: addDays(new Date(), GUIDE_EVIDENCE_VALIDITY_DAYS),
      },
    });
    await harness.guides.verify(trustAgent(), guideId);

    const guide = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } });
    expect(guide.state).toBe('active');
    expect(guide.expiryNotifiedAt).toBeNull();
  });
});

describe('acceptance 3 — a payment demand is flagged, preserved and escalated', () => {
  it('flags the message, preserves the evidence, opens a case and warns the student', async () => {
    const institution = await partnerRunningGuides();
    const { access: guide, guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const studentAccess = studentActor(student.id, guideAccessConsent(guideId));
    const opened = await harness.messaging.openConversation(studentAccess, { guideId });

    const sent = await harness.messaging.send(
      guide,
      opened.conversation.id,
      'If you want a place, send me the deposit — transfer the money to my bank account today.',
    );

    // The student sees a warning, and sees the message.
    expect(sent.message.moderationState).toBe('flagged');
    expect(sent.warning).toContain('never collect tuition');
    expect(sent.message.body).toContain('send me the deposit');

    // The evidence exists, with the body as sent.
    const flags = await prisma.messageFlag.findMany({ where: { messageId: sent.message.id } });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.signal).toBe('payment_solicitation');
    expect(flags[0]?.bodySnapshot).toContain('transfer the money to my bank account');
    expect(flags[0]?.matches.length).toBeGreaterThan(0);

    // And it cannot be edited or removed — by anyone, including the owner.
    await expect(
      prisma.$executeRawUnsafe(`UPDATE message_flags SET "bodySnapshot" = 'nothing to see' WHERE id = $1`, flags[0]?.id),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM message_flags WHERE id = $1`, flags[0]?.id),
    ).rejects.toThrow(/append-only/);

    // A case is open, with the evidence attached to it.
    const cases = await prisma.trustCase.findMany({ where: { targetId: guideId } });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.type).toBe('payment_solicitation');
    expect(cases[0]?.state).toBe('evidence_preserved');
    expect(flags[0]?.trustCaseId).toBe(cases[0]?.id);

    // A payment demand is critical, so the guide is suspended without waiting.
    const after = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } });
    expect(after.state).toBe('suspended');

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: opened.conversation.id },
    });
    expect(conversation.status).toBe('suspended');
    const systemMessages = await prisma.message.findMany({
      where: { conversationId: opened.conversation.id, senderRole: 'system' },
    });
    expect(systemMessages.map((message) => message.systemKind)).toContain('guide_suspended');

    const audit = await prisma.auditEvent.findMany({ where: { objectId: sent.message.id } });
    expect(audit.map((event) => event.action)).toContain('message.flagged');
  });

  it('leaves an ordinary answer about money alone', async () => {
    const institution = await partnerRunningGuides();
    const { access: guide, guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const opened = await harness.messaging.openConversation(
      studentActor(student.id, guideAccessConsent(guideId)),
      { guideId },
    );

    const sent = await harness.messaging.send(
      guide,
      opened.conversation.id,
      'The deposit goes straight to the university through their portal — I never see it. Mine was 1,000 and it came off the first tuition instalment.',
    );

    expect(sent.message.moderationState).toBe('clean');
    expect(sent.warning).toBeNull();
    expect(await prisma.trustCase.count()).toBe(0);
    expect(
      (await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } })).state,
    ).toBe('active');
  });
});

describe('acceptance 4 — no contact detail reaches a student client', () => {
  it('keeps email, phone and legal name out of the directory and the profile', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id, {
      email: 'amara.okonkwo@example.ac.uk',
      languages: ['English', 'Yoruba'],
      topics: ['accommodation'],
    });

    const directory = await harness.guides.directory({ institutionId: institution.id });
    const profile = await harness.guides.publicProfile(guideId);

    for (const payload of [JSON.stringify(directory), JSON.stringify(profile)]) {
      expect(payload).not.toContain('amara.okonkwo@example.ac.uk');
      expect(payload).not.toContain('7700 900123');
      expect(payload).not.toContain('Okonkwo');
    }
    expect(profile.displayName).toBe('Amara O.');
    for (const key of PRIVATE_GUIDE_KEYS) {
      expect((profile as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});

describe('acceptance 5 — a reward cannot be influenced by an admission outcome', () => {
  it('pays for the session that happened, and withholds while a case is open', async () => {
    const institution = await partnerRunningGuides();
    const { access: guideAccess, guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const studentAccess = studentActor(student.id, guideAccessConsent(guideId));

    const slot = await harness.sessions.addSlot(guideAccess, {
      startsAt: addDays(new Date(), 3).toISOString(),
      endsAt: new Date(addDays(new Date(), 3).getTime() + 1_800_000).toISOString(),
      topics: ['accommodation'],
    });
    const session = await harness.sessions.book(studentAccess, { slotId: slot.id });
    const completed = await harness.sessions.complete(guideAccess, session.id, 'completed');
    expect(completed.rewardState).toBe('earned');

    const ledger = await prisma.guideRewardEntry.findMany({ where: { guideId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.state).toBe('earned');
    // There is no column on the ledger, the session or anywhere between them
    // that names an application. This is the schema-level half of the promise.
    expect(Object.keys(ledger[0] ?? {}).join(' ')).not.toMatch(/application|admission|offer/i);

    // A second session while a trust case is open is withheld — the one thing
    // that *can* stop a payout, and it is about conduct, not admission.
    await harness.trust.openCase(systemActor(), {
      type: 'off_platform_contact',
      reporterId: null,
      targetType: 'guide',
      targetId: guideId,
      severity: 'medium',
      summary: 'Test case',
    });
    const secondSlot = await harness.sessions.addSlot(guideAccess, {
      startsAt: addDays(new Date(), 5).toISOString(),
      endsAt: new Date(addDays(new Date(), 5).getTime() + 1_800_000).toISOString(),
    });
    const second = await harness.sessions.book(studentAccess, { slotId: secondSlot.id });
    const withheld = await harness.sessions.complete(guideAccess, second.id, 'completed');
    expect(withheld.rewardState).toBe('withheld');
  });

  it('prevents two students booking the same slot', async () => {
    const institution = await partnerRunningGuides();
    const { access: guideAccess, guideId } = await makeGuide(institution.id);
    const first = await makeStudent('first@example.com');
    const second = await makeStudent('second@example.com');

    const slot = await harness.sessions.addSlot(guideAccess, {
      startsAt: addDays(new Date(), 2).toISOString(),
      endsAt: new Date(addDays(new Date(), 2).getTime() + 1_800_000).toISOString(),
    });

    await harness.sessions.book(studentActor(first.id, guideAccessConsent(guideId)), {
      slotId: slot.id,
    });
    await expect(
      harness.sessions.book(studentActor(second.id, guideAccessConsent(guideId)), {
        slotId: slot.id,
      }),
    ).rejects.toThrow(/booked/i);
  });
});

describe('acceptance 6 — anyone can report anything, and it is auditable', () => {
  it('opens a case from a student report and writes the audit trail', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    const student = await makeStudent();

    const report = await harness.trust.report(studentActor(student.id), {
      targetType: 'guide',
      targetId: guideId,
      type: 'guarantee_claim',
      description: 'They told me on a call that my admission was guaranteed.',
    });

    const trustCase = await harness.trust.detail(report.caseId);
    expect(trustCase.state).toBe('open');
    expect(trustCase.reporterId).toBe(student.id);
    expect(trustCase.events).toHaveLength(1);

    const audit = await prisma.auditEvent.findMany({ where: { objectId: report.caseId } });
    expect(audit.map((event) => event.action)).toContain('trust_case.opened');

    // And a guide can report a student, which is the half people forget.
    const guideReport = await harness.trust.report(guideActor('user_guide_reporter'), {
      targetType: 'user',
      targetId: student.id,
      type: 'harassment',
      description: 'Repeated abusive messages after I said I could not help.',
    });
    expect(guideReport.caseId).toBeTruthy();
  });

  it('refuses an illegal case transition', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);
    const student = await makeStudent();
    const report = await harness.trust.report(studentActor(student.id), {
      targetType: 'guide',
      targetId: guideId,
      type: 'spam',
      description: 'Sent me the same message eight times.',
    });

    const agent = trustAgent();
    await harness.trust.transition(agent, report.caseId, 'dismissed', 'Not a pattern.');
    await expect(
      harness.trust.transition(agent, report.caseId, 'triaging'),
    ).rejects.toThrow(/cannot move/);
  });
});

describe('acceptance 7 and 8 — the directory reflects the rules', () => {
  it('orders by the weighted rules and explains itself', async () => {
    const institution = await partnerRunningGuides();
    await makeGuide(institution.id, {
      email: 'match@example.ac.uk',
      displayName: 'Bilal Ahmed',
      languages: ['English', 'Urdu'],
      topics: ['accommodation', 'cost_of_living'],
      homeCountry: 'PK',
    });
    await makeGuide(institution.id, {
      email: 'other@example.ac.uk',
      displayName: 'Chen Wei',
      languages: ['Mandarin'],
      topics: ['campus_life'],
      homeCountry: 'CN',
    });

    const matches = await harness.guides.directory({
      institutionId: institution.id,
      languages: ['English', 'Urdu'],
      topics: ['accommodation'],
      homeCountry: 'PK',
    });

    expect(matches).toHaveLength(2);
    expect(matches[0]?.profile.displayName).toBe('Bilal A.');
    expect(matches[0]?.matchReason).toMatch(/Urdu|accommodation/);
    // The line the student reads is built from factors that actually scored.
    const scored = matches[0]?.factors.filter((factor) => factor.contribution > 0) ?? [];
    expect(scored.length).toBeGreaterThan(0);
    expect(matches[1]?.matchReason).not.toMatch(/Urdu/);
  });

  it('removes a suspended guide from the directory and tells their students', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id, { topics: ['accommodation'] });
    const student = await makeStudent();
    const opened = await harness.messaging.openConversation(
      studentActor(student.id, guideAccessConsent(guideId)),
      { guideId },
    );

    expect(await harness.guides.directory({ institutionId: institution.id })).toHaveLength(1);

    await harness.guides.suspend(toAuditActor(trustAgent()), guideId, 'Under investigation.');

    expect(await harness.guides.directory({ institutionId: institution.id })).toHaveLength(0);
    await expect(harness.guides.publicProfile(guideId)).rejects.toThrow(/not found/i);

    const messages = await prisma.message.findMany({
      where: { conversationId: opened.conversation.id },
      orderBy: { sentAt: 'asc' },
    });
    const suspension = messages.find((message) => message.systemKind === 'guide_suspended');
    expect(suspension).toBeDefined();
    expect(suspension?.body).toMatch(/suspended/i);
    // The thread is readable, and says why. It is not deleted.
    expect(messages.length).toBeGreaterThan(1);
  });

  it('suspends the whole roster when a partnership is revoked', async () => {
    const institution = await partnerRunningGuides();
    const { guideId } = await makeGuide(institution.id);

    await harness.institutions.revokePartnership(opsUser(), institution.id, 'Contract ended.');
    // Phase 1 enqueues the cascade; this is the handler it was waiting for.
    const cascade = harness.queue.enqueued.find((job) => job.queue === 'partnership-cascade');
    expect(cascade).toBeDefined();
    await harness.reverification.suspendRosterForInstitution(institution.id, 'Partnership revoked.');

    expect(
      (await prisma.studentGuide.findUniqueOrThrow({ where: { id: guideId } })).state,
    ).toBe('suspended');
  });
});

describe('public Q&A needs two independent yeses', () => {
  it('will not publish without both moderation and the guide’s consent', async () => {
    const institution = await partnerRunningGuides();
    const { access: guideAccess, guideId } = await makeGuide(institution.id);
    const student = await makeStudent();

    const question = await harness.qa.ask(studentActor(student.id), {
      institutionId: institution.id,
      topic: 'accommodation',
      body: 'How much is a room in halls, and are bills included?',
    });

    const draft = await harness.qa.answer(guideAccess, question.id, {
      body: 'About 140 a week with bills included, in the older halls.',
      consentToPublish: false,
    });
    await expect(
      harness.qa.moderate(trustAgent(), draft.id, 'approve'),
    ).rejects.toThrow(/has not agreed/);

    await harness.qa.setConsent(guideAccess, draft.id, true);
    await harness.qa.moderate(trustAgent(), draft.id, 'approve');

    const published = await harness.qa.published({ institutionId: institution.id });
    expect(published).toHaveLength(1);
    expect(published[0]?.guideDisplayName).toBe('Amara O.');
    // The question is public; the student who asked it is not.
    const stored = await prisma.guideQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(stored.askedById).toBeNull();

    // Suspending the guide takes their answer off the public site, with no
    // separate cleanup job.
    await harness.guides.suspend(toAuditActor(trustAgent()), guideId, 'Under investigation.');
    expect(await harness.qa.published({ institutionId: institution.id })).toHaveLength(0);
  });

  it('refuses to store an answer that promises an outcome', async () => {
    const institution = await partnerRunningGuides();
    const { access: guideAccess } = await makeGuide(institution.id);
    const student = await makeStudent();
    const question = await harness.qa.ask(studentActor(student.id), {
      institutionId: institution.id,
      topic: 'coursework',
      body: 'Is it hard to get onto the computer science course?',
    });

    await expect(
      harness.qa.answer(guideAccess, question.id, {
        body: 'Apply through me and I guarantee you admission, 100% acceptance.',
        consentToPublish: true,
      }),
    ).rejects.toThrow(AppError);
    expect(await prisma.guideAnswer.count()).toBe(0);
  });
});
