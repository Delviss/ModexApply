import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildAccessContext } from '../../src/auth/access-context.js';
import { toAuditActor } from '../../src/auth/audit-actor.js';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  trustAgent,
  type Harness,
} from './harness.js';
import { ProgramSearchQuerySchema, type AccessContext } from '@modex/contracts';

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

/** A real student row, because every vault route is owner-scoped against it. */
async function student(email = 'ada@example.com'): Promise<AccessContext> {
  const user = await prisma.user.create({
    data: { email, displayName: 'Ada Bello', status: 'active' },
  });
  return buildAccessContext({
    userId: user.id,
    roles: ['student'],
    organisationId: null,
    mfaSatisfied: false,
    consents: [],
  });
}

/** Walks an institution to an active partner, as the Phase 1 suite does. */
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

async function publishedProgramme(
  institutionId: string,
  overrides: { name?: string; field?: string; level?: 'postgraduate_taught' | 'undergraduate' } = {},
) {
  const program = await harness.catalogue.createProgram(opsUser(), institutionId, {
    name: overrides.name ?? 'MSc Data Science',
    level: overrides.level ?? 'postgraduate_taught',
    field: overrides.field ?? 'Computing',
    durationMonths: 12,
  });
  await harness.catalogue.addIntake(opsUser(), program.programKey, {
    startDate: new Date('2027-09-01'),
    applicationDeadline: new Date('2027-07-01'),
  });
  await harness.catalogue.setFees(opsUser(), program.programKey, {
    tuition: { amountMinor: 2_400_000, currency: 'GBP' },
    applicationFee: { amountMinor: 5_000, currency: 'GBP' },
    sourceRef: 'https://example.ac.uk/fees',
  });
  await harness.catalogue.publishProgram(opsUser(), program.programKey);
  await harness.indexer.reindexProgram(program.programKey);
  return program;
}

/** Uploads a document all the way to a scanned state. */
async function uploadDocument(
  access: AccessContext,
  options: { type?: 'transcript' | 'passport'; scan?: 'clean' | 'quarantined' } = {},
) {
  const bytes = Buffer.from('a plausible transcript');
  const created = await harness.documents.createVersion(access, {
    type: options.type ?? 'transcript',
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

describe('the document vault', () => {
  // The acceptance criterion: uploading a new version leaves prior versions
  // intact and retrievable.
  it('keeps every prior version readable after a replacement', async () => {
    const access = await student();
    const first = await uploadDocument(access);
    const second = await harness.documents.createVersion(access, {
      documentId: first.document.id,
      type: 'transcript',
      displayName: 'Transcript.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });

    expect(second.version.version).toBe(2);

    const stored = await prisma.documentVersion.findMany({
      where: { documentId: first.document.id },
      orderBy: { version: 'asc' },
    });
    expect(stored).toHaveLength(2);
    // The object key of version 1 is untouched, which is what makes an
    // application snapshot referencing it still resolvable.
    expect(stored[0].objectKey).toBe(first.version.objectKey);
    expect(stored[0].scanState).toBe('clean');
  });

  it('writes the version row before the upload, so an abandoned upload is visible', async () => {
    const access = await student();
    const created = await harness.documents.createVersion(access, {
      type: 'passport',
      displayName: 'Passport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });

    const stored = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: created.version.id },
    });
    expect(stored.uploadComplete).toBe(false);
    expect(stored.scanState).toBe('pending');
    expect(stored.checksum).toBeNull();
  });

  it('enqueues the scan only once the bytes have landed and matched', async () => {
    const access = await student();
    const bytes = Buffer.from('hello');
    const created = await harness.documents.createVersion(access, {
      type: 'transcript',
      displayName: 'T.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });

    expect(harness.queue.enqueued.filter((job) => job.queue === 'document-scan')).toHaveLength(0);

    harness.storage.put(created.version.objectKey, bytes);
    await harness.documents.finalise(access, created.version.id, {
      checksum: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    });

    expect(harness.queue.enqueued.filter((job) => job.queue === 'document-scan')).toHaveLength(1);
  });

  /**
   * The acceptance criterion in full: a malware-positive upload is quarantined,
   * the student is told, and the file is provably unreachable from any
   * application payload.
   */
  it('quarantines a malware positive and blocks it at the connector boundary', async () => {
    const access = await student();
    const uploaded = await uploadDocument(access, { scan: 'quarantined' });

    const stored = await prisma.documentVersion.findUniqueOrThrow({
      where: { id: uploaded.version.id },
    });
    expect(stored.scanState).toBe('quarantined');

    // The student is told, in words, and told it is permanent.
    const [listed] = await harness.documents.list(access);
    expect(listed.usable).toBe(false);
    expect(listed.blockReason).toMatch(/blocked/i);

    // And the connector cannot have it. This is the assertion that matters:
    // it runs against the method Phase 4 will call, not against the UI.
    await expect(
      harness.documents.resolveForConnector(access.userId, uploaded.version.id),
    ).rejects.toThrow(AppError);
  });

  // Fail-closed: a scanner that never answers must hold the document, not
  // release it.
  it('refuses a pending version at the connector boundary too', async () => {
    const access = await student();
    const bytes = Buffer.from('unscanned');
    const created = await harness.documents.createVersion(access, {
      type: 'transcript',
      displayName: 'T.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });
    harness.storage.put(created.version.objectKey, bytes);
    await harness.documents.finalise(access, created.version.id, {
      checksum: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    });

    // Never scanned.
    await expect(
      harness.documents.resolveForConnector(access.userId, created.version.id),
    ).rejects.toThrow(AppError);
  });

  it('releases a clean version to the connector', async () => {
    const access = await student();
    const uploaded = await uploadDocument(access);
    const resolved = await harness.documents.resolveForConnector(
      access.userId,
      uploaded.version.id,
    );
    expect(resolved.objectKey).toBe(uploaded.version.objectKey);
    expect(resolved.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  /**
   * The IDOR acceptance criterion: an attempt against another student's
   * document is rejected **and** audited.
   */
  it('rejects and audits an attempt on another student\'s document', async () => {
    const owner = await student('owner@example.com');
    const attacker = await student('attacker@example.com');
    const uploaded = await uploadDocument(owner);

    await expect(
      harness.documents.signDownload(attacker, uploaded.version.id),
    ).rejects.toThrow(AppError);

    // Refused at the service, not by a guard that ran before the row was read.
    await expect(
      harness.documents.resolveForConnector(attacker.userId, uploaded.version.id),
    ).rejects.toThrow(AppError);

    const events = await prisma.auditEvent.findMany({
      where: { actorId: attacker.userId, objectId: uploaded.document.id },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => (event.metadata as { refused?: boolean }).refused === true)).toBe(
      true,
    );
  });

  it('issues a short-lived, single-purpose download URL and audits it', async () => {
    const access = await student();
    const uploaded = await uploadDocument(access);
    const signed = await harness.documents.signDownload(access, uploaded.version.id);

    // Short-lived by construction: StorageService caps the TTL at 900s.
    const lifetimeMs = new Date(signed.expiresAt).getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(900_000);
    expect(signed.url).toContain('X-Amz-Expires');

    const audited = await prisma.auditEvent.findFirst({
      where: { action: 'document.download_url_issued', objectId: uploaded.document.id },
    });
    expect(audited).not.toBeNull();
  });
});

describe('the eligibility engine, against real requirements', () => {
  async function programmeWithRequirements(institutionId: string) {
    const program = await publishedProgramme(institutionId);
    await harness.catalogue.addRequirement(opsUser(), program.programKey, {
      ruleType: 'english_language',
      ruleJson: {
        ruleType: 'english_language',
        test: 'ielts',
        overallMinimum: 6.5,
        bandMinimums: { writing: 6 },
      },
      humanSummary: 'IELTS 6.5 overall with at least 6.0 in writing.',
      sourceRef: 'https://example.ac.uk/entry',
    });
    await harness.catalogue.addRequirement(opsUser(), program.programKey, {
      ruleType: 'document_required',
      ruleJson: { ruleType: 'document_required', documentType: 'transcript', certified: false },
      humanSummary: 'An academic transcript is required.',
      sourceRef: 'https://example.ac.uk/entry',
    });
    return program;
  }

  it('returns a structured explanation with a source for every rule', async () => {
    const institution = await activePartner();
    const program = await programmeWithRequirements(institution.id);
    const access = await student();

    const explanation = await harness.eligibility.explain(program.programKey, access.userId);

    expect(explanation.checks).toHaveLength(2);
    for (const check of explanation.checks) {
      expect(check.sourceRef).not.toBeNull();
      expect(check.reason.length).toBeGreaterThan(0);
    }
    // The verdict is dated and pinned to the catalogue version that produced it.
    expect(explanation.catalogueVersion).not.toBeNull();
    expect(explanation.evaluatedAt).toMatch(/^\d{4}-/);
  });

  // An empty profile is unassessed, not ineligible. This is the whole premise.
  it('reports an empty profile as incomplete, never as not eligible', async () => {
    const institution = await activePartner();
    const program = await programmeWithRequirements(institution.id);
    const access = await student();
    await harness.students.getOrCreate(access);

    const explanation = await harness.eligibility.explain(program.programKey, access.userId);
    expect(explanation.verdict).toBe('incomplete');
    expect(explanation.checks.every((check) => check.outcome !== 'fail')).toBe(true);
  });

  /**
   * The load-bearing case, end to end against the database: a quarantined
   * transcript is missing data, not a satisfied document requirement.
   */
  it('will not count a quarantined document as a satisfied requirement', async () => {
    const institution = await activePartner();
    const program = await programmeWithRequirements(institution.id);
    const access = await student();
    await uploadDocument(access, { scan: 'quarantined' });

    const explanation = await harness.eligibility.explain(program.programKey, access.userId);
    const documentCheck = explanation.checks.find((check) => check.ruleType === 'document_required');

    expect(documentCheck?.outcome).toBe('missing_data');
    expect(documentCheck?.reason).toMatch(/malware/i);
  });

  it('counts a clean document as satisfying the requirement', async () => {
    const institution = await activePartner();
    const program = await programmeWithRequirements(institution.id);
    const access = await student();
    await uploadDocument(access, { scan: 'clean' });

    const explanation = await harness.eligibility.explain(program.programKey, access.userId);
    const documentCheck = explanation.checks.find((check) => check.ruleType === 'document_required');
    expect(documentCheck?.outcome).toBe('pass');
  });

  // A partner override is the one place a human changes what a student is told
  // about their own eligibility, so it never happens silently.
  it('audits an override that changes an outcome', async () => {
    const institution = await activePartner();
    const program = await programmeWithRequirements(institution.id);
    const access = await student();

    const requirement = await prisma.requirement.findFirstOrThrow({
      where: { ruleType: 'document_required' },
    });
    await prisma.eligibilityOverride.create({
      data: {
        requirementId: requirement.id,
        institutionId: institution.id,
        outcome: 'pass',
        reason: 'The university confirmed this applicant is exempt.',
        createdBy: 'user_uni',
      },
    });

    const explanation = await harness.eligibility.explain(program.programKey, access.userId);
    const documentCheck = explanation.checks.find((check) => check.ruleType === 'document_required');
    expect(documentCheck?.outcome).toBe('pass');
    expect(documentCheck?.reason).toMatch(/exempt/i);

    const audited = await prisma.auditEvent.findFirst({
      where: { action: 'eligibility.override_applied', objectId: requirement.id },
    });
    expect(audited).not.toBeNull();
  });
});

describe('catalogue search', () => {
  function query(overrides: Record<string, unknown> = {}) {
    return ProgramSearchQuerySchema.parse(overrides);
  }

  it('indexes a published programme and returns it', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);

    const response = await harness.search.search(query({ q: 'data' }), null);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].name).toBe('MSc Data Science');
    expect(response.results[0].tuitionMinor).toBe(2_400_000);
    expect(response.noResults).toBeNull();
  });

  it('returns the ranking factors that produced the order', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);

    const response = await harness.search.search(query({ q: 'data' }), null);
    const [result] = response.results;
    expect(result.factors.length).toBeGreaterThanOrEqual(6);
    const summed = result.factors.reduce((total, factor) => total + factor.contribution, 0);
    expect(result.score).toBeCloseTo(summed, 10);
  });

  /**
   * The freshness rule, applied to search: a programme pulled for a stale
   * blocking field must leave the index, not sit in it with the old price.
   */
  it('drops a programme the freshness sweep pulled', async () => {
    const institution = await activePartner();
    const program = await publishedProgramme(institution.id);

    expect((await harness.search.search(query(), null)).results).toHaveLength(1);

    // Age the source past the SLA, then sweep.
    await prisma.programFees.updateMany({
      where: {},
      data: { sourceUpdatedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
    });
    await harness.freshness.sweep(new Date());
    await harness.indexer.reindexProgram(program.programKey);

    expect((await harness.search.search(query(), null)).results).toHaveLength(0);
  });

  it('never indexes an unpublished programme', async () => {
    const institution = await activePartner();
    const program = await harness.catalogue.createProgram(opsUser(), institution.id, {
      name: 'MSc Secret Studies',
      level: 'postgraduate_taught',
      field: 'Computing',
      durationMonths: 12,
    });
    await harness.indexer.reindexProgram(program.programKey);

    expect((await harness.search.search(query(), null)).results).toHaveLength(0);
  });

  /**
   * The acceptance criterion: a zero-result search always explains why and
   * offers at least one relaxable filter.
   */
  it('explains a zero-result search and names the filter worth relaxing', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);

    const response = await harness.search.search(
      query({ level: ['doctorate'], country: ['GB'] }),
      null,
    );

    expect(response.results).toHaveLength(0);
    expect(response.noResults).not.toBeNull();
    expect(response.noResults!.explanation).not.toMatch(/^0 results/);
    expect(response.noResults!.explanation.length).toBeGreaterThan(20);

    // Dropping the level brings the programme back; dropping the country does
    // not, so only the level is offered.
    const fields = response.noResults!.relaxable.map((filter) => filter.field);
    expect(fields).toContain('level');
    expect(fields).not.toContain('country');
  });

  it('reindexes from the catalogue write, not only when asked', async () => {
    const institution = await activePartner();
    const program = await publishedProgramme(institution.id);

    const jobs = harness.queue.enqueued.filter((job) => job.queue === 'search-index');
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((job) => (job.payload as { programKey: string }).programKey === program.programKey)).toBe(
      true,
    );
  });

  it('offers facets with counts for the filters a student can apply', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);
    await publishedProgramme(institution.id, { name: 'BSc Computer Science', level: 'undergraduate' });

    const response = await harness.search.search(query(), null);
    expect(response.results).toHaveLength(2);

    const levelFacet = response.facets.find((facet) => facet.field === 'level');
    expect(levelFacet).toBeDefined();
    expect(levelFacet!.values.map((value) => value.value).sort()).toEqual([
      'postgraduate_taught',
      'undergraduate',
    ]);
    expect(levelFacet!.values.every((value) => value.count === 1)).toBe(true);
  });

  /**
   * Found by looking at the rendered page: filtering to zero results removed
   * the country facet from the rail entirely, because no visible programme
   * carried that country any more — so the filter that caused the zero could
   * not be unticked, only backed out of.
   */
  it('keeps a selected facet value in the rail even when it now matches nothing', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);

    const response = await harness.search.search(
      query({ level: ['doctorate'], country: ['GB'] }),
      null,
    );
    expect(response.results).toHaveLength(0);

    const countryFacet = response.facets.find((facet) => facet.field === 'country');
    expect(countryFacet).toBeDefined();
    const gb = countryFacet!.values.find((value) => value.value === 'GB');
    expect(gb).toBeDefined();
    // Still listed, and honest about matching nothing right now.
    expect(gb!.count).toBe(0);
  });

  // Facet counts are computed with the facet's own filter excluded, or the
  // rail collapses to the one value already chosen and cannot be changed.
  it('keeps the other options visible once a facet is filtered', async () => {
    const institution = await activePartner();
    await publishedProgramme(institution.id);
    await publishedProgramme(institution.id, { name: 'BSc Computer Science', level: 'undergraduate' });

    const response = await harness.search.search(query({ level: ['undergraduate'] }), null);
    expect(response.results).toHaveLength(1);

    const levelFacet = response.facets.find((facet) => facet.field === 'level');
    expect(levelFacet!.values).toHaveLength(2);
  });
});

describe('the student profile', () => {
  it('creates an empty profile on first read and reports every gap', async () => {
    const access = await student();
    const completeness = await harness.students.completeness(access);

    expect(completeness.completed).toBe(0);
    expect(completeness.missing.length).toBe(completeness.total);
    for (const gap of completeness.missing) {
      expect(gap.unlocks.length).toBeGreaterThan(0);
    }
  });

  it('applies a partial update without clearing the rest', async () => {
    const access = await student();
    await harness.students.patch(access, { nationality: 'NG' });
    await harness.students.patch(access, { intendedField: 'Computer Science' });

    const profile = await harness.students.getOrCreate(access);
    expect(profile.nationality).toBe('NG');
    expect(profile.intendedField).toBe('Computer Science');
  });

  it('records field names in the audit trail, never values', async () => {
    const access = await student();
    await harness.students.patch(access, { nationality: 'NG' });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'profile.updated', actorId: access.userId },
    });
    const metadata = event.metadata as { fields?: string[] };
    expect(metadata.fields).toEqual(['nationality']);
    expect(JSON.stringify(event.metadata)).not.toContain('NG');
  });
});
