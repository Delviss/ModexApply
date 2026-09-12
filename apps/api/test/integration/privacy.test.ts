import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DATA_MAP } from '@modex/contracts';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  studentActor,
  type Harness,
} from './harness.js';

/**
 * Access, export and erasure, demonstrated end to end on a real account
 * (Phase 7 §2 and its acceptance criterion).
 *
 * The interesting assertions are the ones about what *survives*: an erasure
 * that quietly took the audit trail or a university's record of a submitted
 * application with it would pass a naive "is it gone?" test and fail the
 * obligation it exists to satisfy.
 */
let prisma: PrismaClient;
let harness: Harness;

const YEAR = 365 * 24 * 60 * 60 * 1000;

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

async function partner() {
  return prisma.institution.create({
    data: {
      legalName: 'University of Example Ltd',
      displayName: 'University of Example',
      domains: ['example.ac.uk'],
      country: 'GB',
      verificationState: 'verified',
      verificationStage: 'active',
      partnerships: {
        create: {
          status: 'active',
          contractRef: 'contract://2026/example.pdf',
          startDate: new Date(Date.now() - YEAR),
          scopes: ['catalogue_publish', 'direct_application'],
        },
      },
    },
  });
}

async function studentWithData(email = 'ada@example.com') {
  const institution = await partner();
  const user = await prisma.user.create({
    data: { email, displayName: 'Ada Bello', status: 'active', phone: '+2348012345678' },
  });
  await prisma.userRoleGrant.create({ data: { userId: user.id, role: 'student' } });
  const access = studentActor(user.id);

  await harness.students.patch(access, {
    dateOfBirth: '2002-04-01',
    nationality: 'NG',
    countryOfResidence: 'NG',
    intendedLevel: 'postgraduate_taught',
    intendedField: 'Computing',
  });

  const document = await harness.documents.createVersion(access, {
    type: 'passport',
    displayName: 'Passport',
    contentType: 'application/pdf',
    sizeBytes: 2_048,
  });
  harness.storage.put(document.version.objectKey, Buffer.from('pretend passport bytes'));

  await prisma.consentGrant.create({
    data: { userId: user.id, scope: 'support_access', noticeVersion: 'support-v1' },
  });

  return { user, access, institution, document };
}

describe('who has my data', () => {
  it('answers with the student’s own holdings, not a generic notice', async () => {
    const { access, user } = await studentWithData();
    await harness.impersonation.start(opsUser('operator-1'), {
      subjectId: user.id,
      reason: 'Student asked for help with a stuck upload in ticket 12.',
      reference: 'TICKET-12',
      minutes: 10,
    });

    const overview = await harness.privacy.overview(access);

    expect(overview.dataMap).toHaveLength(DATA_MAP.length);
    expect(overview.holdings.profile).toBe(true);
    expect(overview.holdings.documents).toBe(1);
    expect(overview.holdings.consents.map((row) => row.scope)).toContain('support_access');

    // The support visit is visible to its subject, with the reason and ticket.
    expect(overview.holdings.supportVisits).toHaveLength(1);
    expect(overview.holdings.supportVisits[0]?.reference).toBe('TICKET-12');
  });

  it('says which categories cannot simply be deleted, and why', async () => {
    const { access } = await studentWithData('plan@example.com');
    const overview = await harness.privacy.overview(access);
    const retained = overview.erasurePlan.filter((row) => row.treatment !== 'deleted');
    expect(retained.length).toBeGreaterThan(0);
    for (const row of retained) {
      expect(row.explanation.length).toBeGreaterThan(20);
    }
  });
});

describe('export', () => {
  it('includes what the student gave us and names their files without inlining them', async () => {
    const { access } = await studentWithData('export@example.com');
    const exported = await harness.privacy.export(access);

    expect(exported.formatVersion).toBe('1.0');
    expect(exported.categories.profile).not.toBeNull();
    expect(Array.isArray(exported.categories.documents)).toBe(true);

    // Checksums and names, not base64 bytes: a passport inlined into a JSON
    // file in a downloads folder is not a favour to anybody.
    const serialised = JSON.stringify(exported);
    expect(serialised).not.toContain('pretend passport bytes');
    expect(serialised).toContain('Passport');
  });

  it('writes both an audit event for the request and one for the result', async () => {
    const { access, user } = await studentWithData('audited@example.com');
    await harness.privacy.export(access);

    const trail = await harness.audit.trailFor('user', user.id);
    const actions = trail.map((event) => event.action);
    expect(actions).toContain('privacy.export_requested');
    expect(actions).toContain('privacy.export_completed');
  });
});

describe('erasure', () => {
  it('deletes what it can, anonymises what it must keep, and says which is which', async () => {
    const { access, user, document } = await studentWithData('erase@example.com');

    const result = await harness.privacy.erase(access, 'I no longer want an account.');

    expect(result.erased).toBe(true);
    expect(result.objectsRemoved).toBe(1);
    expect(harness.storage.objects.has(document.version.objectKey)).toBe(false);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('closed');
    expect(after.email).not.toBe('erase@example.com');
    expect(after.displayName).toBe('Erased account');
    expect(after.phone).toBeNull();
    expect(after.passwordHash).toBeNull();

    expect(await prisma.studentProfile.count({ where: { userId: user.id } })).toBe(0);

    // Named, not hidden.
    expect(result.retained.explanation.length).toBeGreaterThan(0);
  });

  it('revokes every session, so an erased account cannot keep browsing', async () => {
    const { access, user } = await studentWithData('sessions@example.com');
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: `hash-${user.id}`,
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + YEAR),
      },
    });

    await harness.privacy.erase(access);
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('keeps a submitted application, and says so in the result', async () => {
    const { access, user, institution } = await studentWithData('applied@example.com');

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
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    const application = await harness.applications.start(access, {
      programKey: program.programKey,
      intakeId: intake.id,
    });
    await prisma.application.update({
      where: { id: application.id },
      data: { state: 'submitted', externalRef: 'UNI-REF-1', submittedAt: new Date() },
    });

    const result = await harness.privacy.erase(access);
    expect(result.retained.applications).toBe(1);

    const kept = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(kept.externalRef).toBe('UNI-REF-1');
    expect(kept.studentId).toBe(user.id);
  });

  it('leaves the audit trail intact — including the erasure itself', async () => {
    const { access, user } = await studentWithData('audit@example.com');
    const before = (await harness.audit.trailFor('user', user.id)).length;

    await harness.privacy.erase(access);

    const after = await harness.audit.trailFor('user', user.id);
    expect(after.length).toBeGreaterThan(before);
    expect(after.map((event) => event.action)).toContain('privacy.erasure_completed');
  });
});
