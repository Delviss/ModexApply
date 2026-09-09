import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { money } from '@modex/contracts';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../src/common/errors/app-error.js';
import { validateTimeline } from '../../src/catalogue/effective-dating.js';
import { TXT_RECORD_PREFIX } from '../../src/institutions/domain-verification.service.js';
import { toAuditActor } from '../../src/auth/audit-actor.js';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  trustAgent,
  universityAdmin,
  type Harness,
} from './harness.js';

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
});

/** Walks an institution all the way to an active, catalogue-publishing partner. */
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
    summary: 'Companies House record and charity registration confirmed.',
  });
  await harness.institutions.advanceVerification(agent, institution.id, 'legal_entity_check');

  const challenge = await harness.domains.issueChallenge(
    toAuditActor(agent),
    institution.id,
    domain,
  );
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

describe('the verification pipeline, end to end', () => {
  it('reaches verified only by walking every stage with its evidence', async () => {
    const institution = await activePartner();
    const stored = await prisma.institution.findUniqueOrThrow({ where: { id: institution.id } });
    expect(stored.verificationState).toBe('verified');
    expect(stored.verificationStage).toBe('active');

    const partnership = await prisma.institutionPartnership.findFirstOrThrow({
      where: { institutionId: institution.id },
    });
    expect(partnership.status).toBe('active');
  });

  // The acceptance criterion, checked against the database rather than a mock:
  // the shortcut is not merely refused, the evidence is read from storage so a
  // caller cannot assert it.
  it('rejects a jump straight to active on a fresh institution', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Shortcut University',
      displayName: 'Shortcut University',
      domains: ['shortcut.ac.uk'],
      country: 'GB',
    });

    await expect(
      harness.institutions.advanceVerification(trustAgent(), institution.id, 'active'),
    ).rejects.toThrow(AppError);

    const stored = await prisma.institution.findUniqueOrThrow({ where: { id: institution.id } });
    expect(stored.verificationState).toBe('unverified');
    expect(stored.verificationStage).toBeNull();
  });

  it('records the refusal in the audit trail', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Shortcut University',
      displayName: 'Shortcut University',
      domains: ['shortcut.ac.uk'],
      country: 'GB',
    });
    await harness.institutions
      .advanceVerification(trustAgent(), institution.id, 'active')
      .catch(() => undefined);

    const trail = await harness.audit.trailFor('institution', institution.id);
    expect(trail.map((event) => event.action)).toContain('institution.verification_failed');
  });

  it('refuses a domain challenge for a domain the institution has not claimed', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Example',
      displayName: 'Example',
      domains: ['example.ac.uk'],
      country: 'GB',
    });
    await expect(
      harness.domains.issueChallenge(toAuditActor(opsUser()), institution.id, 'not-ours.com'),
    ).rejects.toThrow(/not claimed/i);
  });

  it('does not confirm a domain until the record is actually published', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Example',
      displayName: 'Example',
      domains: ['example.ac.uk'],
      country: 'GB',
    });
    const challenge = await harness.domains.issueChallenge(
      toAuditActor(opsUser()),
      institution.id,
      'example.ac.uk',
    );

    const before = await harness.domains.checkChallenge(toAuditActor(opsUser()), challenge.id);
    expect(before.confirmed).toBe(false);

    // Real resolvers split long TXT values across strings; joining them is
    // required, not an optimisation.
    harness.dns.publishChunked('_modex-challenge.example.ac.uk', challenge.recordValue);
    const after = await harness.domains.checkChallenge(toAuditActor(opsUser()), challenge.id);
    expect(after.confirmed).toBe(true);
    expect(challenge.recordValue.startsWith(TXT_RECORD_PREFIX)).toBe(true);
  });

  it('refuses an authorised signatory on an off-domain address', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Example',
      displayName: 'Example',
      domains: ['example.ac.uk'],
      country: 'GB',
    });
    await expect(
      harness.institutions.addContact(opsUser(), institution.id, {
        fullName: 'Someone',
        email: 'someone@gmail.com',
        role: 'authorised_signatory',
        isAuthorisedSignatory: true,
      }),
    ).rejects.toThrow(/official institution address/i);
  });

  it('keeps verification evidence out of the public projection', async () => {
    const institution = await activePartner();
    const publicView = await harness.institutions.findPublicBySlugOrId(institution.id);
    expect(publicView.canDisplayVerifiedBadge).toBe(true);
    expect(JSON.stringify(publicView)).not.toContain('Companies House');
    expect(JSON.stringify(publicView)).not.toContain('contract://');
  });
});

describe('the catalogue', () => {
  it('refuses to publish without an active partnership', async () => {
    const institution = await harness.institutions.create(opsUser(), {
      legalName: 'Unpartnered University',
      displayName: 'Unpartnered University',
      domains: ['unpartnered.ac.uk'],
      country: 'GB',
    });
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });

    await expect(
      harness.catalogue.publishProgram(opsUser(), program.programKey),
    ).rejects.toThrow(/active partnership/i);
  });

  it('refuses to publish with no intake whose deadline is still ahead', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });

    await expect(harness.catalogue.publishProgram(opsUser(), program.programKey)).rejects.toThrow(
      /future application deadline/i,
    );

    await harness.catalogue.addIntake(
      opsUser(),
      program.programKey,
      { startDate: new Date('2020-09-01'), applicationDeadline: new Date('2020-07-01') },
      new Date('2020-01-01'),
    );
    await expect(harness.catalogue.publishProgram(opsUser(), program.programKey)).rejects.toThrow(
      /future application deadline/i,
    );
  });

  it('publishes with an active partnership, the scope and a future intake', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });

    const published = await harness.catalogue.publishProgram(opsUser(), program.programKey);
    expect(published.status).toBe('published');
  });

  /**
   * The effective-dating acceptance criterion: editing a live programme creates a
   * new record, the prior version stays readable, and a snapshot referencing it
   * is unaffected.
   */
  describe('effective dating', () => {
    it('supersedes rather than overwrites, and keeps the old version readable', async () => {
      const institution = await activePartner();
      const v1 = await harness.catalogue.createProgram(opsUser(), institution.id, {
        name: 'MSc Data Science',
        level: 'postgraduate_taught',
        field: 'Computing',
        durationMonths: 12,
      });

      // A student's application snapshot points at this exact version id.
      const snapshotVersionId = v1.id;

      const v2 = await harness.catalogue.updateProgram(
        opsUser(),
        v1.programKey,
        { name: 'MSc Data Science and AI', durationMonths: 15 },
        new Date('2026-07-01T00:00:00.000Z'),
      );

      expect(v2.id).not.toBe(v1.id);
      expect(v2.version).toBe(2);
      expect(v2.name).toBe('MSc Data Science and AI');

      const snapshot = await prisma.program.findUniqueOrThrow({ where: { id: snapshotVersionId } });
      expect(snapshot.name).toBe('MSc Data Science');
      expect(snapshot.durationMonths).toBe(12);
      expect(snapshot.effectiveTo).toEqual(new Date('2026-07-01T00:00:00.000Z'));

      const history = await harness.catalogue.programHistory(v1.programKey);
      expect(history).toHaveLength(2);
      expect(validateTimeline(history).valid).toBe(true);
    });

    it('carries requirements onto the new version', async () => {
      const institution = await activePartner();
      const v1 = await harness.catalogue.createProgram(opsUser(), institution.id, {
        name: 'MSc Data Science',
        level: 'postgraduate_taught',
        field: 'Computing',
        durationMonths: 12,
      });
      await harness.catalogue.addRequirement(opsUser(), v1.programKey, {
        ruleType: 'english_language',
        ruleJson: {
          ruleType: 'english_language',
          test: 'ielts',
          overallMinimum: 6.5,
          bandMinimums: { writing: 6 },
        },
        humanSummary: 'IELTS 6.5 overall with no band below 6.0.',
        sourceRef: 'https://example.ac.uk/entry',
      });

      const v2 = await harness.catalogue.updateProgram(opsUser(), v1.programKey, { field: 'Data' });

      expect(await prisma.requirement.count({ where: { programId: v1.id } })).toBe(1);
      expect(await prisma.requirement.count({ where: { programId: v2.id } })).toBe(1);
    });

    it('keeps a valid timeline across several edits', async () => {
      const institution = await activePartner();
      const v1 = await harness.catalogue.createProgram(opsUser(), institution.id, {
        name: 'BSc Computer Science',
        level: 'undergraduate',
        field: 'Computing',
        durationMonths: 36,
      });
      await harness.catalogue.updateProgram(opsUser(), v1.programKey, { field: 'CS' }, new Date('2026-02-01'));
      await harness.catalogue.updateProgram(opsUser(), v1.programKey, { field: 'Comp Sci' }, new Date('2026-03-01'));
      await harness.catalogue.updateProgram(opsUser(), v1.programKey, { field: 'Computer Science' }, new Date('2026-04-01'));

      const history = await harness.catalogue.programHistory(v1.programKey);
      expect(history).toHaveLength(4);
      expect(validateTimeline(history)).toEqual({ valid: true, problems: [] });
    });
  });

  describe('requirements', () => {
    it('refuses a rule it cannot parse rather than storing an unusable one', async () => {
      const institution = await activePartner();
      const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
        name: 'MSc',
        level: 'postgraduate_taught',
        field: 'Computing',
        durationMonths: 12,
      });

      await expect(
        harness.catalogue.addRequirement(opsUser(), program.programKey, {
          ruleType: 'gpa_minimum',
          ruleJson: { ruleType: 'gpa_minimum', scale: 'martian_scale', comparison: 'gte', value: 3 },
          humanSummary: 'A GPA of at least 3.0.',
          sourceRef: 'https://example.ac.uk/entry',
        }),
      ).rejects.toThrow(AppError);

      expect(await prisma.requirement.count()).toBe(0);
    });

    it('refuses a rule whose declared type disagrees with its payload', async () => {
      const institution = await activePartner();
      const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
        name: 'MSc',
        level: 'postgraduate_taught',
        field: 'Computing',
        durationMonths: 12,
      });

      await expect(
        harness.catalogue.addRequirement(opsUser(), program.programKey, {
          ruleType: 'work_experience',
          ruleJson: { ruleType: 'age_minimum', years: 18 },
          humanSummary: 'At least two years of relevant work experience.',
          sourceRef: 'https://example.ac.uk/entry',
        }),
      ).rejects.toThrow(AppError);
    });
  });

  describe('the organisation boundary', () => {
    it('stops one university writing to another catalogue', async () => {
      const a = await activePartner('a.ac.uk');
      const b = await activePartner('b.ac.uk');

      await expect(
        harness.catalogue.createProgram(universityAdmin(b.id), a.id, {
          name: 'Injected programme',
          level: 'undergraduate',
          field: 'Computing',
          durationMonths: 36,
        }),
      ).rejects.toThrow(/another institution/i);

      expect(await prisma.program.count({ where: { institutionId: a.id } })).toBe(0);
    });
  });
});

describe('partnership revocation', () => {
  it('unpublishes every live programme in the same transaction', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    const result = await harness.institutions.revokePartnership(
      trustAgent(),
      institution.id,
      'Contract terminated by the university on 1 June.',
    );

    expect(result.unpublishedCount).toBe(1);
    const after = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey, effectiveTo: null },
    });
    expect(after.status).toBe('unpublished');

    const stored = await prisma.institution.findUniqueOrThrow({ where: { id: institution.id } });
    expect(stored.verificationState).toBe('revoked');

    // The slower cascade -- guide roster, notifications, connector teardown --
    // goes to the queue; the programme unpublish does not wait for it.
    expect(harness.queue.enqueued.map((entry) => entry.queue)).toContain('partnership-cascade');
  });

  it('drops the verified badge immediately', async () => {
    const institution = await activePartner();
    await harness.institutions.revokePartnership(trustAgent(), institution.id, 'Contract terminated.');
    const publicView = await harness.institutions.findPublicBySlugOrId(institution.id);
    expect(publicView.canDisplayVerifiedBadge).toBe(false);
  });
});

describe('the freshness sweep', () => {
  it('hides a programme whose tuition figure has gone past its SLA', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });
    await harness.catalogue.setFees(opsUser(), program.programKey, {
      tuition: money(2400000, 'GBP'),
    });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    // The fee SLA is 14 days; sweep as though a month has passed.
    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const result = await harness.freshness.sweep(later);

    expect(result.programsMarked).toBe(1);
    expect(result.programsHidden).toBe(1);
    expect(result.institutionsAffected).toContain(institution.id);

    const swept = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey, effectiveTo: null },
    });
    expect(swept.syncState).toBe('stale');
    expect(swept.staleFields).toContain('tuitionFee');
    // A blocking-field lapse takes the record off the public site.
    expect(swept.status).toBe('in_review');

    await expect(harness.catalogue.getPublicProgram(program.programKey)).rejects.toThrow(
      /temporarily unavailable/i,
    );
  });

  it('alerts ops through the audit trail rather than failing quietly', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });
    await harness.catalogue.setFees(opsUser(), program.programKey, { tuition: money(100000, 'GBP') });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    const swept = await prisma.program.findFirstOrThrow({
      where: { programKey: program.programKey, effectiveTo: null },
    });
    await harness.freshness.sweep(new Date(Date.now() + 40 * 24 * 60 * 60 * 1000));

    const trail = await harness.audit.trailFor('program', swept.id);
    expect(trail.map((event) => event.action)).toContain('catalogue.marked_stale');
  });

  it('leaves a fresh programme alone', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.catalogue.addIntake(opsUser(), program.programKey, {
      startDate: new Date('2027-09-01'),
      applicationDeadline: new Date('2027-07-01'),
    });
    await harness.catalogue.setFees(opsUser(), program.programKey, { tuition: money(100000, 'GBP') });
    await harness.catalogue.publishProgram(opsUser(), program.programKey);

    expect((await harness.freshness.sweep(new Date())).programsMarked).toBe(0);
  });
});

describe('bulk import', () => {
  const csv = [
    'externalRef,name,level,field,durationMonths,tuition,tuitionCurrency,applicationDeadline,intakeStartDate',
    'MSC-DS,MSc Data Science,postgraduate_taught,Computing,12,24000.00,GBP,2027-07-01,2027-09-01',
    'BSC-CS,BSc Computer Science,undergraduate,Computing,36,18500.00,GBP,2027-07-01,2027-09-01',
    'BAD-ROW,,undergraduate,Computing,36,,,,',
  ].join('\n');

  it('produces a reviewable diff and changes nothing', async () => {
    const institution = await activePartner();
    const result = await harness.ingestion.dryRun(opsUser(), institution.id, {
      fileName: 'catalogue.csv',
      fileRef: 'imports/abc',
      content: csv,
    });

    expect(result.summary.created).toBe(2);
    expect(result.summary.errored).toBe(1);
    expect(await prisma.program.count()).toBe(0);

    const stored = await prisma.catalogueImport.findUniqueOrThrow({ where: { id: result.importId } });
    expect(stored.state).toBe('dry_run');
  });

  it('commits exactly the reviewed diff, skipping the error rows', async () => {
    const institution = await activePartner();
    const dryRun = await harness.ingestion.dryRun(opsUser(), institution.id, {
      fileName: 'catalogue.csv',
      fileRef: 'imports/abc',
      content: csv,
    });

    const committed = await harness.ingestion.commit(opsUser(), dryRun.importId);
    expect(committed.created).toBe(2);
    expect(committed.skipped).toBe(1);

    const programs = await prisma.program.findMany();
    expect(programs).toHaveLength(2);
    // Imported rows land in review, never straight onto the public site.
    expect(programs.every((program) => program.status === 'in_review')).toBe(true);
    expect(programs.every((program) => program.syncState === 'pending_review')).toBe(true);
  });

  it('refuses to commit the same import twice', async () => {
    const institution = await activePartner();
    const dryRun = await harness.ingestion.dryRun(opsUser(), institution.id, {
      fileName: 'catalogue.csv',
      fileRef: 'imports/abc',
      content: csv,
    });
    await harness.ingestion.commit(opsUser(), dryRun.importId);
    await expect(harness.ingestion.commit(opsUser(), dryRun.importId)).rejects.toThrow(
      /already committed/i,
    );
  });

  it('stops one university importing into another catalogue', async () => {
    const a = await activePartner('a.ac.uk');
    const b = await activePartner('b.ac.uk');
    await expect(
      harness.ingestion.dryRun(universityAdmin(b.id), a.id, {
        fileName: 'catalogue.csv',
        fileRef: 'imports/abc',
        content: csv,
      }),
    ).rejects.toThrow(/another institution/i);
  });
});
