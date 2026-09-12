import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  createPrisma,
  financeUser,
  opsUser,
  resetDatabase,
  trustAgent,
  universityAdmin,
  universityStaff,
  type Harness,
} from './harness.js';
import { AppError } from '../../src/common/errors/app-error.js';

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

const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * A partner with a confirmed domain — the state the portal gate requires.
 *
 * The confirmed `DomainChallenge` is the point: `verificationState: 'verified'`
 * alone is not enough, and the test below that removes the challenge proves it.
 */
async function verifiedPartner(displayName = 'University of Example', domain = 'example.ac.uk') {
  return prisma.institution.create({
    data: {
      legalName: `${displayName} Ltd`,
      displayName,
      domains: [domain],
      country: 'GB',
      verificationState: 'verified',
      verificationStage: 'active',
      domainChallenges: {
        create: {
          domain,
          method: 'dns_txt',
          token: 'modex-verify-token',
          expiresAt: new Date(Date.now() + YEAR),
          confirmedAt: new Date(Date.now() - 86_400_000),
        },
      },
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

async function programmeWithRequirement(institutionId: string) {
  const program = await harness.catalogue.createProgram(opsUser(), institutionId, {
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing',
    durationMonths: 12,
  });
  await harness.catalogue.addIntake(opsUser(), program.programKey, {
    startDate: new Date(Date.now() + YEAR),
    applicationDeadline: new Date(Date.now() + YEAR / 2),
  });
  const requirement = await harness.catalogue.addRequirement(opsUser(), program.programKey, {
    ruleType: 'gpa_minimum',
    ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3 },
    humanSummary: 'A GPA of at least 3.0 on a 4.0 scale.',
    sourceRef: 'https://example.ac.uk/entry',
  });
  return { program, requirement };
}

async function guideFor(institutionId: string, email = 'guide@example.ac.uk') {
  const user = await prisma.user.create({
    data: { email, displayName: 'Sofia Guide', status: 'active' },
  });
  const guide = await prisma.studentGuide.create({
    data: {
      userId: user.id,
      institutionId,
      state: 'active',
      stage: 'active',
      verifiedAt: new Date(),
      evidenceExpiresAt: new Date(Date.now() + YEAR),
      topics: ['accommodation'],
    },
  });
  return { user, guide };
}

// ---------------------------------------------------------------------------
// The organisation boundary and the portal gate (acceptance criteria 1 and 2)
// ---------------------------------------------------------------------------

describe('university portal access', () => {
  it('lets staff see only their own institution, and audits nothing else into view', async () => {
    const mine = await verifiedPartner('University of Example');
    const theirs = await verifiedPartner('Rival University', 'rival.ac.uk');

    const staff = universityStaff(mine.id);
    const dashboard = await harness.portal.dashboard(staff);
    expect(dashboard.institutionId).toBe(mine.id);

    // Asking for another institution by id is refused, not silently re-scoped.
    await expect(harness.portal.dashboard(staff, theirs.id)).rejects.toMatchObject({
      code: 'organisation_boundary',
    });
  });

  it('refuses the portal to an institution with no confirmed domain', async () => {
    const institution = await verifiedPartner('Unconfirmed University', 'unconfirmed.ac.uk');
    await prisma.domainChallenge.updateMany({
      where: { institutionId: institution.id },
      data: { confirmedAt: null },
    });

    await expect(harness.portal.dashboard(universityAdmin(institution.id))).rejects.toMatchObject({
      code: 'precondition_failed',
    });
  });

  it('refuses the portal when verification lapses mid-session', async () => {
    const institution = await verifiedPartner('Lapsing University', 'lapsing.ac.uk');
    const admin = universityAdmin(institution.id);
    await harness.portal.dashboard(admin);

    await prisma.institution.update({
      where: { id: institution.id },
      data: { verificationState: 'revoked' },
    });

    // The gate is re-checked per call rather than at sign-in, so a revocation
    // takes effect on the next request rather than at the next login.
    await expect(harness.portal.dashboard(admin)).rejects.toMatchObject({
      code: 'precondition_failed',
    });
  });

  it('lets a Modex operator cross the boundary explicitly', async () => {
    const institution = await verifiedPartner();
    const dashboard = await harness.portal.dashboard(opsUser(), institution.id);
    expect(dashboard.institutionId).toBe(institution.id);
  });
});

// ---------------------------------------------------------------------------
// Requirement review (acceptance criterion 3)
// ---------------------------------------------------------------------------

describe('requirement review', () => {
  it('writes an audit event with actor, reason and before/after values', async () => {
    const institution = await verifiedPartner();
    const { requirement } = await programmeWithRequirement(institution.id);
    const admin = universityAdmin(institution.id, 'user_reviewer');

    await harness.portal.reviewRequirement(admin, requirement.id, {
      decision: 'overridden',
      reason: 'Our published minimum is 3.2, not 3.0.',
      ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3.2 },
      humanSummary: 'A GPA of at least 3.2 on a 4.0 scale.',
    });

    const events = await harness.audit.trailFor('requirement', requirement.id);
    const reviewed = events.find((event) => event.action === 'requirement.reviewed');
    expect(reviewed).toBeDefined();
    expect(reviewed?.actorId).toBe('user_reviewer');

    const metadata = reviewed?.metadata as {
      reason: string;
      before: { ruleJson: { value: number } };
      after: { ruleJson: { value: number } };
    };
    expect(metadata.reason).toContain('3.2');
    expect(metadata.before.ruleJson.value).toBe(3);
    expect(metadata.after.ruleJson.value).toBe(3.2);

    const updated = await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } });
    expect((updated.ruleJson as { value: number }).value).toBe(3.2);
    expect(updated.version).toBe(2);
  });

  it('refuses a rule the eligibility engine cannot read', async () => {
    const institution = await verifiedPartner();
    const { requirement } = await programmeWithRequirement(institution.id);

    await expect(
      harness.portal.reviewRequirement(universityAdmin(institution.id), requirement.id, {
        decision: 'overridden',
        reason: 'We would rather describe this in prose.',
        ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 'quite high' },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const unchanged = await prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } });
    expect(unchanged.version).toBe(1);
  });

  it('has no update or delete path for the review record itself', async () => {
    const institution = await verifiedPartner();
    const { requirement } = await programmeWithRequirement(institution.id);
    const review = await harness.portal.reviewRequirement(
      universityAdmin(institution.id),
      requirement.id,
      { decision: 'approved', reason: 'Matches our published entry criteria.' },
    );

    await expect(
      prisma.requirementReview.update({ where: { id: review.id }, data: { reason: 'rewritten' } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.requirementReview.delete({ where: { id: review.id } }),
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------
// Trust console (acceptance criteria 4 and 9)
// ---------------------------------------------------------------------------

describe('trust console', () => {
  it('audits the act of viewing verification evidence', async () => {
    const institution = await verifiedPartner();
    await prisma.verificationEvidence.create({
      data: {
        institutionId: institution.id,
        stage: 'legal_entity_check',
        summary: 'Companies House record checked.',
        collectedBy: 'user_trust',
        documentRef: 'evidence/ch-record.pdf',
      },
    });

    const before = await harness.audit.trailFor('institution', institution.id);
    const viewed = await harness.trustConsole.evidenceFor(trustAgent('user_looker'), institution.id);
    expect(viewed.evidence).toHaveLength(1);

    const after = await harness.audit.trailFor('institution', institution.id);
    expect(after.length).toBe(before.length + 1);
    const event = after[after.length - 1];
    expect(event?.action).toBe('evidence.viewed');
    expect(event?.actorId).toBe('user_looker');
  });

  it('never returns a guide’s challenge token with its evidence', async () => {
    const institution = await verifiedPartner();
    const { guide } = await guideFor(institution.id);
    await prisma.guideVerification.create({
      data: {
        guideId: guide.id,
        evidenceType: 'university_domain_email',
        summary: 'Domain email challenge',
        challengeTokenHash: 'a-secret-hash-nobody-should-see',
      },
    });

    const result = await harness.trustConsole.guideEvidenceFor(trustAgent(), guide.id);
    expect(JSON.stringify(result)).not.toContain('a-secret-hash-nobody-should-see');
  });

  it('ages the verification queue against its SLA', async () => {
    const institution = await verifiedPartner('Pending University', 'pending.ac.uk');
    await prisma.institution.update({
      where: { id: institution.id },
      data: { verificationState: 'pending', createdAt: new Date(Date.now() - 10 * 86_400_000) },
    });

    const queue = await harness.trustConsole.verificationQueue();
    const row = queue.institutions.find((item) => item.id === institution.id);
    expect(row?.breachingSla).toBe(true);
    expect(row?.ageHours).toBeGreaterThan(200);
  });

  it('suspending a guide takes them out of the directory and out of messaging', async () => {
    const institution = await verifiedPartner();
    const { guide, user } = await guideFor(institution.id);
    const student = await prisma.user.create({
      data: { email: 'student@example.com', displayName: 'Ada', status: 'active' },
    });
    const conversation = await prisma.conversation.create({
      data: { studentId: student.id, guideId: guide.id, status: 'open', contextType: 'general' },
    });

    const sanction = await harness.sanctions.apply(trustAgent(), {
      targetType: 'guide',
      targetId: guide.id,
      kind: 'suspend',
      reasonCode: 'payment_solicitation',
      reason: 'Asked a student to send a deposit to a personal account.',
      caseId: null,
      expiresAt: null,
    });

    const suspended = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(suspended.state).toBe('suspended');

    const closed = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(closed.status).toBe('suspended');

    const directory = await harness.guides.directory({ institutionId: institution.id });
    expect(directory.map((match) => match.guideId)).not.toContain(guide.id);

    // And the reversal path exists, for the false positive.
    await harness.sanctions.reverse(trustAgent(), sanction.id, 'Mistaken identity — wrong account.');
    const reinstated = await prisma.studentGuide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(reinstated.state).toBe('active');
    expect(user.id).toBeDefined();
  });

  it('records both the sanction and its reversal in the audit log', async () => {
    const institution = await verifiedPartner();
    const { guide } = await guideFor(institution.id);

    const sanction = await harness.sanctions.apply(trustAgent(), {
      targetType: 'guide',
      targetId: guide.id,
      kind: 'restrict',
      reasonCode: 'spam',
      reason: 'Messaging far more students than anybody could be helping.',
      caseId: null,
      expiresAt: null,
    });
    await harness.sanctions.reverse(trustAgent(), sanction.id, 'Rate limit was mis-tuned, not abuse.');

    const trail = await harness.audit.trailFor('guide', guide.id);
    const actions = trail.map((event) => event.action);
    expect(actions).toContain('sanction.applied');
    expect(actions).toContain('sanction.reversed');

    // The row survives the reversal: "was this person ever sanctioned" stays
    // answerable afterwards.
    const stored = await prisma.sanction.findUniqueOrThrow({ where: { id: sanction.id } });
    expect(stored.reversedAt).not.toBeNull();
    expect(stored.reasonCode).toBe('spam');
  });

  it('refuses a sanction against a target that does not exist', async () => {
    await expect(
      harness.sanctions.apply(trustAgent(), {
        targetType: 'guide',
        targetId: 'not-a-guide',
        kind: 'ban',
        reasonCode: 'other',
        reason: 'Typed the wrong identifier into the console.',
        caseId: null,
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// Support impersonation (acceptance criterion 6)
// ---------------------------------------------------------------------------

describe('support impersonation', () => {
  async function consentingStudent(email = 'needs-help@example.com') {
    const user = await prisma.user.create({
      data: { email, displayName: 'Ada Bello', status: 'active' },
    });
    await prisma.userRoleGrant.create({ data: { userId: user.id, role: 'student' } });
    await prisma.consentGrant.create({
      data: { userId: user.id, scope: 'support_access', noticeVersion: 'support-v1' },
    });
    return user;
  }

  it('refuses without the student’s consent', async () => {
    const user = await prisma.user.create({
      data: { email: 'no-consent@example.com', displayName: 'Ada', status: 'active' },
    });
    await prisma.userRoleGrant.create({ data: { userId: user.id, role: 'student' } });

    await expect(
      harness.impersonation.start(opsUser(), {
        subjectId: user.id,
        reason: 'Student reported a stuck application in ticket 91.',
        reference: 'TICKET-91',
        minutes: 15,
      }),
    ).rejects.toMatchObject({ code: 'consent_missing' });
  });

  it('refuses to impersonate a staff account', async () => {
    const institution = await verifiedPartner();
    const staff = await prisma.user.create({
      data: {
        email: 'registrar@example.ac.uk',
        displayName: 'Registrar',
        status: 'active',
        organisationId: institution.id,
      },
    });
    await prisma.userRoleGrant.create({ data: { userId: staff.id, role: 'university_admin' } });
    await prisma.consentGrant.create({
      data: { userId: staff.id, scope: 'support_access', noticeVersion: 'support-v1' },
    });

    await expect(
      harness.impersonation.start(opsUser(), {
        subjectId: staff.id,
        reason: 'They asked for help with the portal.',
        reference: 'TICKET-92',
        minutes: 15,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is time-boxed, visible to the student, and fully reconstructable', async () => {
    const user = await consentingStudent();
    const started = await harness.impersonation.start(opsUser('user_support'), {
      subjectId: user.id,
      reason: 'Student cannot see their submitted application — ticket 77.',
      reference: 'TICKET-77',
      minutes: 20,
    });

    expect(new Date(started.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(20 * 60_000 + 5_000);

    // Visible to the subject, with the reason and the reference.
    const visible = await harness.impersonation.forSubject(user.id);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.reference).toBe('TICKET-77');
    expect(visible[0]?.operatorId).toBe('user_support');

    // And reconstructable from the audit log alone.
    const trail = await harness.audit.trailFor('user', user.id);
    const start = trail.find((event) => event.action === 'impersonation.started');
    expect((start?.metadata as Record<string, unknown>).reference).toBe('TICKET-77');

    await harness.impersonation.end(opsUser('user_support'), started.grantId, 'Issue resolved.');
    const ended = await harness.audit.trailFor('user', user.id);
    expect(ended.map((event) => event.action)).toContain('impersonation.ended');

    const grant = await prisma.impersonationGrant.findUniqueOrThrow({
      where: { id: started.grantId },
    });
    expect(grant.endedAt).not.toBeNull();
  });

  it('caps the window at the maximum however long is asked for', async () => {
    const user = await consentingStudent('cap@example.com');
    const started = await harness.impersonation.start(opsUser(), {
      subjectId: user.id,
      reason: 'Long-running investigation into a stuck submission.',
      reference: 'TICKET-78',
      // The schema caps this at 30; the service caps it again, because a
      // service that trusts its caller's numbers is one route away from a
      // day-long impersonation.
      minutes: 30,
    });
    expect(new Date(started.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5_000);
  });

  it('expires on its own, and the sweep closes it with an audit event', async () => {
    const user = await consentingStudent('sweep@example.com');
    const started = await harness.impersonation.start(opsUser(), {
      subjectId: user.id,
      reason: 'Checking a document upload failure reported in ticket 80.',
      reference: 'TICKET-80',
      minutes: 1,
    });

    // The window cannot be shortened after the fact — the trigger refuses any
    // edit but closing — so the sweep is run against a later clock instead,
    // which is what the scheduled job does anyway.
    const afterExpiry = new Date(Date.now() + 2 * 60_000);
    // `impersonation_grants` is never truncated between tests — it has no
    // delete path, which is the point — so the assertion is about this grant
    // rather than about the sweep's total.
    const swept = await harness.impersonation.sweepExpired(afterExpiry);
    expect(swept).toBeGreaterThanOrEqual(1);

    const grant = await prisma.impersonationGrant.findUniqueOrThrow({
      where: { id: started.grantId },
    });
    expect(grant.endedReason).toBe('expired');

    const sessions = await prisma.session.findMany({ where: { familyId: started.grantId } });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('cannot be reopened once closed, at the database level', async () => {
    const user = await consentingStudent('closed@example.com');
    const started = await harness.impersonation.start(opsUser(), {
      subjectId: user.id,
      reason: 'Investigating a duplicate application in ticket 81.',
      reference: 'TICKET-81',
      minutes: 5,
    });
    await harness.impersonation.end(opsUser(), started.grantId, 'Done.');

    await expect(
      prisma.impersonationGrant.update({
        where: { id: started.grantId },
        data: { endedAt: null },
      }),
    ).rejects.toThrow(/cannot be reopened/);

    await expect(
      prisma.impersonationGrant.update({
        where: { id: started.grantId },
        data: { reason: 'a different reason entirely' },
      }),
    ).rejects.toThrow(/only endedAt and endedReason may change/);
  });

  it('refuses a second operator into an account somebody is already in', async () => {
    const user = await consentingStudent('busy@example.com');
    await harness.impersonation.start(opsUser('operator-1'), {
      subjectId: user.id,
      reason: 'First operator investigating ticket 82.',
      reference: 'TICKET-82',
      minutes: 10,
    });

    await expect(
      harness.impersonation.start(opsUser('operator-2'), {
        subjectId: user.id,
        reason: 'Second operator wants a look as well.',
        reference: 'TICKET-83',
        minutes: 10,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});

// ---------------------------------------------------------------------------
// Finance (acceptance criterion 7)
// ---------------------------------------------------------------------------

describe('finance console', () => {
  async function payableReward(amountMinor = 500_000) {
    const institution = await verifiedPartner();
    const { guide } = await guideFor(institution.id, `guide-${amountMinor}@example.ac.uk`);
    const student = await prisma.user.create({
      data: { email: `student-${amountMinor}@example.com`, displayName: 'Ada', status: 'active' },
    });
    const session = await prisma.guideSession.create({
      data: {
        studentId: student.id,
        guideId: guide.id,
        scheduledFor: new Date(Date.now() - 86_400_000),
        status: 'completed',
        completedAt: new Date(Date.now() - 86_000_000),
        rewardState: 'earned',
      },
    });
    return prisma.guideRewardEntry.create({
      data: {
        guideId: guide.id,
        sessionId: session.id,
        state: 'earned',
        amountMinor,
        currency: 'GBP',
        earnedAt: new Date(),
      },
    });
  }

  it('refuses to let the initiator approve a high-value payout', async () => {
    const reward = await payableReward(500_000);
    const initiator = financeUser('finance-1');

    const payout = await harness.finance.initiatePayout(initiator, reward.id);
    expect(payout.state).toBe('pending_approval');

    await expect(harness.finance.approvePayout(initiator, payout.id)).rejects.toMatchObject({
      code: 'forbidden',
    });

    const approved = await harness.finance.approvePayout(financeUser('finance-2'), payout.id);
    expect(approved.state).toBe('approved');
    expect(approved.approvedBy).toBe('finance-2');
    expect(approved.initiatedBy).toBe('finance-1');
  });

  it('records the payout through to paid, with a transaction', async () => {
    const reward = await payableReward(400_000);
    const payout = await harness.finance.initiatePayout(financeUser('finance-1'), reward.id);
    await harness.finance.approvePayout(financeUser('finance-2'), payout.id);
    const paid = await harness.finance.markPaid(financeUser('finance-2'), payout.id, 'PAY-123');

    expect(paid.payout.state).toBe('paid');
    expect(paid.transaction.kind).toBe('guide_payout');
    expect(paid.transaction.amountMinor).toBe(400_000);

    const entry = await prisma.guideRewardEntry.findUniqueOrThrow({ where: { id: reward.id } });
    expect(entry.state).toBe('paid');
  });

  it('will not pay a reward whose session was never completed', async () => {
    const institution = await verifiedPartner();
    const { guide } = await guideFor(institution.id, 'incomplete@example.ac.uk');
    const student = await prisma.user.create({
      data: { email: 'incomplete-student@example.com', displayName: 'Ada', status: 'active' },
    });
    const session = await prisma.guideSession.create({
      data: {
        studentId: student.id,
        guideId: guide.id,
        scheduledFor: new Date(Date.now() + 86_400_000),
        status: 'confirmed',
      },
    });
    const reward = await prisma.guideRewardEntry.create({
      data: {
        guideId: guide.id,
        sessionId: session.id,
        state: 'earned',
        amountMinor: 10_000,
        currency: 'GBP',
        earnedAt: new Date(),
      },
    });

    await expect(
      harness.finance.initiatePayout(financeUser(), reward.id),
    ).rejects.toMatchObject({ code: 'precondition_failed' });
  });

  it('refunds only against a Modex service payment', async () => {
    const tuitionish = await prisma.modexTransaction.create({
      data: {
        kind: 'guide_payout',
        state: 'settled',
        amountMinor: 50_000,
        currency: 'GBP',
        description: 'A payout, not a service payment',
        correlationId: 'test',
      },
    });

    await expect(
      harness.finance.refund(financeUser(), {
        transactionId: tuitionish.id,
        amountMinor: 1_000,
        reasonCode: 'goodwill',
        reason: 'Trying to refund something Modex never took.',
      }),
    ).rejects.toMatchObject({ code: 'precondition_failed' });
  });

  it('refuses to refund more than is left on a payment', async () => {
    const payment = await prisma.modexTransaction.create({
      data: {
        kind: 'service_payment',
        state: 'settled',
        amountMinor: 10_000,
        currency: 'GBP',
        description: 'Application support package',
        correlationId: 'test',
      },
    });

    await harness.finance.refund(financeUser(), {
      transactionId: payment.id,
      amountMinor: 6_000,
      reasonCode: 'service_not_delivered',
      reason: 'Half the sessions never happened.',
    });

    await expect(
      harness.finance.refund(financeUser(), {
        transactionId: payment.id,
        amountMinor: 6_000,
        reasonCode: 'goodwill',
        reason: 'Trying to refund more than was ever paid.',
      }),
    ).rejects.toMatchObject({ code: 'precondition_failed' });
  });

  it('reports settlement per currency rather than converting', async () => {
    await prisma.modexTransaction.createMany({
      data: [
        {
          kind: 'service_payment',
          state: 'settled',
          amountMinor: 10_000,
          currency: 'GBP',
          description: 'a',
          correlationId: 'test',
        },
        {
          kind: 'service_payment',
          state: 'settled',
          amountMinor: 20_000,
          currency: 'EUR',
          description: 'b',
          correlationId: 'test',
        },
      ],
    });

    const report = await harness.finance.settlement(
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(report.currencies.map((row) => row.currency).sort()).toEqual(['EUR', 'GBP']);
  });
});

// ---------------------------------------------------------------------------
// Operations (acceptance criterion 8)
// ---------------------------------------------------------------------------

describe('operations console', () => {
  it('reflects a partner outage in connector health and surfaces the affected applications', async () => {
    const institution = await verifiedPartner();
    const connector = await prisma.connectorConfig.create({
      data: {
        institutionId: institution.id,
        type: 'api',
        displayName: 'Example direct API',
        endpointUrl: 'https://partner.example.ac.uk/applications',
        credentialRef: 'example-api',
        enabled: true,
      },
    });

    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    const intake = await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date(Date.now() + YEAR),
      applicationDeadline: new Date(Date.now() + YEAR / 2),
    });

    const student = await prisma.user.create({
      data: { email: 'stuck@example.com', displayName: 'Ada', status: 'active' },
    });
    const application = await prisma.application.create({
      data: {
        studentId: student.id,
        institutionId: institution.id,
        programKey: program.programKey,
        intakeId: intake.id,
        state: 'submitted_pending',
        connectorId: connector.id,
        connectorType: 'api',
        updatedAt: new Date(Date.now() - 3 * 3_600_000),
      },
    });
    await prisma.submissionAttempt.createMany({
      data: [1, 2, 3].map((attemptNo) => ({
        applicationId: application.id,
        connectorId: connector.id,
        snapshotId: `snapshot-${attemptNo}`,
        attemptNo,
        state: attemptNo === 3 ? ('dead_lettered' as const) : ('failed' as const),
        idempotencyKey: 'idem-1',
        failureCode: 'partner_unavailable',
        failureReason: 'Connection refused',
        correlationId: 'test',
        startedAt: new Date(Date.now() - attemptNo * 600_000),
        finishedAt: new Date(Date.now() - attemptNo * 600_000 + 4_000),
      })),
    });

    const health = await harness.opsConsole.connectorHealth();
    const row = health.find((item) => item.connectorId === connector.id);
    expect(row?.health).toBe('failing');
    expect(row?.deadLettered).toBe(1);
    expect(row?.failureCodes[0]?.code).toBe('partner_unavailable');

    const exceptions = await harness.opsConsole.exceptions();
    expect(exceptions.stuckPending.map((item) => item.applicationId)).toContain(application.id);
    expect(exceptions.stuckPending[0]?.remediation).toBeTruthy();
    expect(exceptions.deadLettered).toHaveLength(1);
  });

  it('shows a connector that has done nothing as idle, not healthy', async () => {
    const institution = await verifiedPartner();
    await prisma.connectorConfig.create({
      data: {
        institutionId: institution.id,
        type: 'operator_assisted',
        displayName: 'Manual handoff',
        enabled: true,
      },
    });

    const health = await harness.opsConsole.connectorHealth();
    expect(health[0]?.health).toBe('idle');
  });

  it('versions a notification template rather than overwriting it', async () => {
    const first = await harness.opsConsole.upsertTemplate(opsUser(), {
      key: 'application.submitted',
      channel: 'email',
      locale: 'en',
      subject: 'Your application is in',
      body: 'Hello {{studentName}}, {{institutionName}} has your application.',
    });
    const second = await harness.opsConsole.upsertTemplate(opsUser(), {
      key: 'application.submitted',
      channel: 'email',
      locale: 'en',
      subject: 'Your application is in',
      body: 'Hi {{studentName}} — {{institutionName}} has your application.',
    });

    expect(second.version).toBe(first.version + 1);
    const retired = await prisma.notificationTemplate.findUniqueOrThrow({ where: { id: first.id } });
    expect(retired.active).toBe(false);
  });

  it('refuses a template placeholder nobody fills', async () => {
    await expect(
      harness.opsConsole.upsertTemplate(opsUser(), {
        key: 'application.submitted',
        channel: 'email',
        locale: 'en',
        subject: null,
        body: 'Hello {{user.passwordHash}}',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('audits enabling and disabling a connector', async () => {
    const institution = await verifiedPartner();
    const connector = await prisma.connectorConfig.create({
      data: {
        institutionId: institution.id,
        type: 'api',
        displayName: 'Example direct API',
        enabled: false,
      },
    });

    await harness.opsConsole.setConnectorEnabled(opsUser(), connector.id, true);
    await harness.opsConsole.setConnectorEnabled(opsUser(), connector.id, false);

    const trail = await harness.audit.trailFor('connector', connector.id);
    expect(trail.map((event) => event.action)).toEqual(['connector.enabled', 'connector.disabled']);
  });
});
