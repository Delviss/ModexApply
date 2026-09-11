import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAccessContext } from '../../src/auth/access-context.js';
import { toAuditActor } from '../../src/auth/audit-actor.js';
import { AppError } from '../../src/common/errors/app-error.js';
import {
  createHarness,
  createPrisma,
  opsUser,
  resetDatabase,
  trustAgent,
  universityAdmin,
  type Harness,
} from './harness.js';
import { formatMoney, money, type AccessContext } from '@modex/contracts';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * A verified partner, built directly rather than walked through the Phase 1
 * pipeline: that pipeline has its own integration test, and repeating it in
 * every fixture here would make these tests fail for reasons that have nothing
 * to do with offers.
 */
async function institution(displayName = 'University of Example') {
  return prisma.institution.create({
    data: {
      legalName: `${displayName} Ltd`,
      displayName,
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

async function programme(institutionId: string, tuitionMinor = 2_400_000) {
  const program = await harness.catalogue.createProgram(opsUser(), institutionId, {
    name: 'MSc Data Science',
    level: 'postgraduate_taught',
    field: 'Computing',
    durationMonths: 12,
  });
  const intake = await harness.catalogue.addIntake(opsUser(), program.programKey, {
    startDate: new Date(Date.now() + YEAR),
    applicationDeadline: new Date(Date.now() + YEAR / 2),
  });
  await harness.catalogue.setFees(opsUser(), program.programKey, {
    tuition: { amountMinor: tuitionMinor, currency: 'GBP' },
    applicationFee: { amountMinor: 5_000, currency: 'GBP' },
    sourceRef: 'https://example.ac.uk/fees',
  });
  await harness.catalogue.publishProgram(opsUser(), program.programKey);
  return { program, intake };
}

/** A profile that passes the GPA condition the fixtures below use. */
async function student(email = 'ada@example.com', gpa = 3.8): Promise<AccessContext> {
  const user = await prisma.user.create({
    data: { email, displayName: 'Ada Bello', status: 'active' },
  });
  const access = buildAccessContext({
    userId: user.id,
    roles: ['student'],
    organisationId: null,
    mfaSatisfied: false,
    consents: [],
  });
  await harness.students.patch(access, {
    dateOfBirth: '2002-04-01',
    nationality: 'NG',
    countryOfResidence: 'NG',
    intendedLevel: 'postgraduate_taught',
    intendedField: 'Computing',
    academicRecords: [
      {
        level: 'bachelors',
        institutionName: 'University of Lagos',
        countryCode: 'NG',
        fieldOfStudy: 'Computing',
        grade: { scale: 'gpa_4', value: gpa },
        startedAt: '2019-09-01T00:00:00.000Z',
        completedAt: '2023-07-01T00:00:00.000Z',
      },
    ],
  });
  return access;
}

const gpaCondition = (value = 3.5) => ({
  id: `cond-gpa-${value}`,
  ruleType: 'gpa_minimum' as const,
  ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value },
  humanSummary: `A grade point average of ${value} or above on a 4.0 scale.`,
  sourceRef: 'https://example.ac.uk/scholarships',
});

const nationalityCondition = {
  id: 'cond-nationality',
  ruleType: 'nationality_restriction' as const,
  ruleJson: { ruleType: 'nationality_restriction', comparison: 'in', countries: ['IN', 'PK'] },
  humanSummary: 'Open to nationals of India and Pakistan.',
  sourceRef: 'https://example.ac.uk/scholarships/country',
};

interface OfferOptions {
  offerKey?: string;
  name?: string;
  type?: 'scholarship' | 'tuition_discount' | 'application_fee_waiver' | 'deposit_incentive' | 'student_benefit';
  value?: Parameters<typeof harness.offers.createDraft>[2]['value'];
  appliesTo?: 'tuition' | 'application_fee' | 'deposit' | 'none';
  conditions?: unknown[];
  exclusions?: unknown[];
  programKey?: string | null;
  validUntil?: Date;
  claimDeadline?: Date | null;
  applicationMethod?: string | null;
  redemptionMethod?: string | null;
  publish?: boolean;
}

/** Drafts, verifies through Trust, and publishes — the whole pipeline. */
async function liveOffer(institutionId: string, options: OfferOptions = {}) {
  const admin = universityAdmin(institutionId);
  const offerKey = options.offerKey ?? 'merit-award';
  const type = options.type ?? 'tuition_discount';

  await harness.offers.createDraft(admin, offerKey, {
    institutionId,
    programKey: options.programKey ?? null,
    type,
    name: options.name ?? 'Merit award',
    value: options.value ?? { kind: 'percentage', basisPoints: 1000 },
    appliesTo: options.appliesTo ?? 'tuition',
    duration: 'first_year',
    conditions: options.conditions ?? [gpaCondition()],
    exclusions: options.exclusions ?? [],
    termsSummary: 'Applies to the first year of tuition only.',
    applicationMethod:
      options.applicationMethod ?? (type === 'scholarship' ? 'Apply through Modex.' : null),
    redemptionMethod: options.redemptionMethod ?? null,
    claimDeadline:
      options.claimDeadline === undefined
        ? type === 'scholarship'
          ? new Date(Date.now() + YEAR / 3).toISOString()
          : null
        : (options.claimDeadline?.toISOString() ?? null),
    validFrom: new Date(Date.now() - 1_000).toISOString(),
    validUntil: (options.validUntil ?? new Date(Date.now() + YEAR)).toISOString(),
    sourceRef: 'https://example.ac.uk/scholarships',
  });

  await harness.offers.verify(trustAgent(), offerKey, {
    verified: true,
    verifierName: 'A. Okafor, Modex Trust',
  });

  if (options.publish !== false) await harness.offers.publish(admin, offerKey);
  return harness.offers.current(offerKey);
}

async function application(access: AccessContext, programKey: string, intakeId: string) {
  return harness.applications.start(access, { programKey, intakeId });
}

// ---------------------------------------------------------------------------

describe('the publication gate', () => {
  it('refuses to publish an offer missing source, verifier or last-checked date', async () => {
    const inst = await institution();
    const admin = universityAdmin(inst.id);

    await harness.offers.createDraft(admin, 'incomplete', {
      institutionId: inst.id,
      programKey: null,
      type: 'tuition_discount',
      name: 'Incomplete discount',
      value: { kind: 'percentage', basisPoints: 1000 },
      appliesTo: 'tuition',
      duration: 'first_year',
      conditions: [],
      exclusions: [],
      termsSummary: null,
      applicationMethod: null,
      redemptionMethod: null,
      claimDeadline: null,
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + YEAR).toISOString(),
      sourceRef: null,
    });

    const error = await harness.offers.publish(admin, 'incomplete').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const messages = (error as AppError).fieldErrors!.map((field) => field.message).join(' ');
    expect(messages).toMatch(/source reference/i);
    expect(messages).toMatch(/eligibility condition/i);
    expect(messages).toMatch(/named verifier/i);
    expect(messages).toMatch(/last checked/i);

    const stored = await prisma.offer.findFirst({ where: { offerKey: 'incomplete' } });
    expect(stored!.publicationState).toBe('draft');
  });

  it('will not let the database hold a published offer with no verifier at all', async () => {
    const inst = await institution();
    await liveOffer(inst.id, { offerKey: 'gated', publish: false });

    // The service is one enforcement; this is the other. Going around the
    // service must not be a way to publish something nobody checked.
    const attempt = prisma.$executeRawUnsafe(
      `UPDATE offers SET "publicationState" = 'published', "verifiedBy" = NULL WHERE "offerKey" = 'gated'`,
    );
    await expect(attempt).rejects.toThrow(/offers_publishable/);
  });

  it('a university cannot verify its own offer', async () => {
    const inst = await institution();
    const admin = universityAdmin(inst.id);
    // `offer:verify` is not in the university_admin grant — the RBAC table is
    // what makes self-verification impossible, so assert on the table itself.
    expect(admin.permissions.has('offer:verify')).toBe(false);
    expect(trustAgent().permissions.has('offer:verify')).toBe(true);
  });

  it('refuses an offer belonging to another institution', async () => {
    const mine = await institution();
    const theirs = await institution('Other University');
    const admin = universityAdmin(mine.id);
    await liveOffer(theirs.id, { offerKey: 'theirs' });

    await expect(harness.offers.publish(admin, 'theirs')).rejects.toThrow(/another institution/i);
  });
});

describe('the price breakdown', () => {
  it('reproduces the net price from offer versions and sources', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });
    const access = await student();

    const pricing = await harness.offerPricing.priceProgramme(
      program.programKey,
      access.userId,
    );

    expect(pricing.breakdown.totalSaving).toEqual(money(240_000, 'GBP'));
    expect(pricing.breakdown.netPrice).toEqual(money(2_165_000, 'GBP'));

    const saving = pricing.breakdown.lines.find((line) => line.kind === 'saving')!;
    expect(saving.offerKey).toBe('merit-award');
    expect(saving.offerVersion).toBe(1);
    expect(saving.sourceRef).toBe('https://example.ac.uk/scholarships');
  });

  it('shows an ineligible offer with its unmet condition and leaves it out of the price', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    await liveOffer(inst.id, {
      offerKey: 'country-award',
      name: 'Country award',
      programKey: program.programKey,
      conditions: [nationalityCondition],
    });
    const access = await student();

    const pricing = await harness.offerPricing.priceProgramme(program.programKey, access.userId);

    expect(pricing.breakdown.totalSaving).toEqual(money(0, 'GBP'));
    expect(pricing.breakdown.netPrice).toEqual(pricing.breakdown.grossTotal);
    expect(pricing.offers).toHaveLength(1);
    expect(pricing.offers[0]!.eligible).toBe(false);
    // The offer's own condition, in the university's words — not the shared
    // engine's "this programme…", which would be false on a scholarship card.
    expect(pricing.breakdown.ineligible[0]!.unmetCondition).toBe(
      'This offer requires: Open to nationals of India and Pakistan. Your profile says NG.',
    );
  });

  it('treats an unassessed condition as unassessed, never as a rejection', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });

    // No profile at all — an anonymous visitor.
    const pricing = await harness.offerPricing.priceProgramme(program.programKey, null);

    expect(pricing.offers[0]!.eligible).toBe(false);
    expect(pricing.breakdown.ineligible[0]!.outcome).toBe('missing_data');
    expect(pricing.breakdown.ineligible[0]!.remedy).toMatch(/profile/i);
  });

  it('applies one of two non-combinable offers and states why the other did not apply', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);

    await liveOffer(inst.id, {
      offerKey: 'merit-award',
      name: 'Merit award',
      programKey: program.programKey,
      value: { kind: 'percentage', basisPoints: 2000 },
    });
    await liveOffer(inst.id, {
      offerKey: 'partner-discount',
      name: 'Partner discount',
      programKey: program.programKey,
      value: { kind: 'percentage', basisPoints: 500 },
      exclusions: [
        {
          kind: 'not_combinable_with_offer',
          otherOfferKey: 'merit-award',
          otherOfferType: null,
          programKeys: [],
          humanSummary: 'Not combinable with the merit award.',
        },
      ],
    });

    const access = await student();
    const pricing = await harness.offerPricing.priceProgramme(program.programKey, access.userId);

    expect(pricing.breakdown.applied.map((offer) => offer.offerKey)).toEqual(['merit-award']);
    expect(pricing.breakdown.suppressed).toHaveLength(1);
    expect(pricing.breakdown.suppressed[0]!.offerKey).toBe('partner-discount');
    expect(pricing.breakdown.suppressed[0]!.reason).toMatch(/Not combinable with the merit award/);
    expect(pricing.breakdown.suppressed[0]!.supersededBy).toBe('Merit award');
  });

  it('cannot be made to price an offer with no last-checked date', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    const offer = await liveOffer(inst.id, { programKey: program.programKey });

    // The card refuses to render an offer with no last-checked date, and the
    // read path filters one out before that. Neither gets the chance: putting a
    // published offer into that shape is refused by the database, so the state
    // the guards defend against is unreachable rather than merely handled.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE offers SET "lastCheckedAt" = NULL WHERE id = '${offer.id}'`,
      ),
    ).rejects.toThrow(/offers_publishable/);

    const pricing = await harness.offerPricing.priceProgramme(program.programKey, null);
    expect(pricing.offers).toHaveLength(1);
    expect(pricing.offers[0]!.lastCheckedAt).not.toBeNull();
  });

  it('drops an unpublished offer from the price the moment it is pulled', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    const offer = await liveOffer(inst.id, { programKey: program.programKey });
    const access = await student();

    expect(
      (await harness.offerPricing.priceProgramme(program.programKey, access.userId)).offers,
    ).toHaveLength(1);

    await harness.offers.unpublish(toAuditActor(opsUser()), offer.id, 'Pulled by the partner.');

    const after = await harness.offerPricing.priceProgramme(program.programKey, access.userId);
    expect(after.offers).toHaveLength(0);
    expect(after.breakdown.netPrice).toEqual(after.breakdown.grossTotal);
  });
});

describe('versioning', () => {
  it('does not retroactively change what an existing application referenced', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');

    const attachedTo = await prisma.applicationOffer.findFirst({
      where: { applicationId: app.id },
    });

    // The university halves the award.
    const next = await harness.offers.supersede(universityAdmin(inst.id), 'merit-award', {
      value: { kind: 'percentage', basisPoints: 500 },
    });
    expect(next.version).toBe(2);

    const stillAttached = await prisma.applicationOffer.findFirst({
      where: { applicationId: app.id },
      include: { offer: true },
    });
    expect(stillAttached!.offerId).toBe(attachedTo!.offerId);
    expect(stillAttached!.offer.version).toBe(1);
    expect(stillAttached!.offer.basisPoints).toBe(1000);
    // And the frozen copy on the attachment agrees with it.
    expect(stillAttached!.basisPoints).toBe(1000);
  });

  it('starts a superseded offer unverified and unpublished, and tells the holders', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    harness.queue.clear();

    const next = await harness.offers.supersede(universityAdmin(inst.id), 'merit-award', {
      name: 'Merit award (revised)',
    });

    expect(next.publicationState).toBe('draft');
    expect(next.verificationState).toBe('unverified');
    expect(harness.queue.enqueued.filter((job) => job.job === 'offer-changed')).toHaveLength(1);
  });
});

describe('the auto-expiry sweep', () => {
  it('removes a lapsed offer from search, pricing and applications, and notifies students', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, {
      programKey: program.programKey,
      validUntil: new Date(Date.now() + 60_000),
    });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    harness.queue.clear();

    const later = new Date(Date.now() + 120_000);
    const result = await harness.offerExpiry.sweep(later);

    expect(result.expired).toBe(1);
    expect(result.studentsNotified).toBe(1);
    expect(result.reindexed).toContain(program.programKey);

    const offer = await prisma.offer.findFirst({ where: { offerKey: 'merit-award' } });
    expect(offer!.publicationState).toBe('expired');
    expect(offer!.unpublishedReason).toMatch(/validity window closed/i);

    // The attachment is expired, not deleted: the student can still see that
    // they held it and when it lapsed.
    const attachment = await prisma.applicationOffer.findFirst({
      where: { applicationId: app.id },
    });
    expect(attachment!.state).toBe('expired');
    expect(attachment!.expiredAt).not.toBeNull();

    const pricing = await harness.offerPricing.priceProgramme(program.programKey, access.userId, later);
    expect(pricing.offers).toHaveLength(0);
    expect(pricing.breakdown.netPrice).toEqual(pricing.breakdown.grossTotal);

    expect(harness.queue.enqueued.filter((job) => job.job === 'offer-expired')).toHaveLength(1);
  });

  it('is a no-op when replayed', async () => {
    const inst = await institution();
    const { program } = await programme(inst.id);
    await liveOffer(inst.id, {
      programKey: program.programKey,
      validUntil: new Date(Date.now() + 60_000),
    });

    const later = new Date(Date.now() + 120_000);
    expect((await harness.offerExpiry.sweep(later)).expired).toBe(1);
    expect((await harness.offerExpiry.sweep(later)).expired).toBe(0);
  });

  it('warns the holders of an offer closing inside three days', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, {
      programKey: program.programKey,
      validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    harness.queue.clear();

    await harness.offerExpiry.sweep();
    expect(harness.queue.enqueued.filter((job) => job.job === 'offer-closing')).toHaveLength(1);
  });
});

describe('the source/display mismatch signal', () => {
  it('unpublishes the offer, opens a trust case and notifies the partner', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    const offer = await liveOffer(inst.id, { programKey: program.programKey });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    harness.queue.clear();

    const result = await harness.offerIntegrity.recordSourceCheck(trustAgent(), {
      offerKey: 'merit-award',
      sourceRef: 'https://example.ac.uk/scholarships',
      matched: false,
      checkedBy: 'A. Okafor, Modex Trust',
      observed: { value: { kind: 'percentage', basisPoints: 200 } },
    });

    expect(result.matched).toBe(false);
    expect(result.unpublished).toBe(true);
    expect(result.trustCaseId).not.toBeNull();
    expect(result.partnerNotified).toBe(true);

    const stored = await prisma.offer.findUnique({ where: { id: offer.id } });
    expect(stored!.publicationState).toBe('unpublished');
    expect(stored!.verificationState).toBe('revoked');
    // The source's number is emphatically *not* written onto the offer.
    expect(stored!.basisPoints).toBe(1000);

    const trustCase = await prisma.trustCase.findUnique({ where: { id: result.trustCaseId! } });
    expect(trustCase!.type).toBe('fraudulent_offer');
    expect(trustCase!.targetType).toBe('offer');
    expect(trustCase!.severity).toBe('high');
    expect(trustCase!.state).toBe('evidence_preserved');

    const check = await prisma.offerSourceCheck.findFirst({ where: { offerId: offer.id } });
    expect(check!.trustCaseId).toBe(result.trustCaseId);

    expect(harness.queue.enqueued.map((job) => job.job)).toContain('offer-mismatch-partner');
    expect(harness.queue.enqueued.map((job) => job.job)).toContain('offer-withdrawn');

    // And it is gone from the price the next student sees.
    const pricing = await harness.offerPricing.priceProgramme(program.programKey, access.userId);
    expect(pricing.offers).toHaveLength(0);
  });

  it('moves the last-checked date forward on a matching check without touching anything else', async () => {
    const inst = await institution();
    const offer = await liveOffer(inst.id);
    const before = (await prisma.offer.findUnique({ where: { id: offer.id } }))!.lastCheckedAt!;

    const later = new Date(before.getTime() + 60 * 60 * 1000);
    const result = await harness.offerIntegrity.recordSourceCheck(
      trustAgent(),
      {
        offerKey: 'merit-award',
        sourceRef: 'https://example.ac.uk/scholarships',
        matched: true,
        checkedBy: 'A. Okafor, Modex Trust',
        observed: {},
      },
      later,
    );

    expect(result.unpublished).toBe(false);
    expect(result.trustCaseId).toBeNull();
    const after = await prisma.offer.findUnique({ where: { id: offer.id } });
    expect(after!.lastCheckedAt!.getTime()).toBe(later.getTime());
    expect(after!.publicationState).toBe('published');
    expect(after!.syncState).toBe('synced');
  });

  it('lists offers whose last check is past the freshness SLA', async () => {
    const inst = await institution();
    const offer = await liveOffer(inst.id);
    expect(await harness.offerIntegrity.dueForRecheck(inst.id)).toHaveLength(0);

    await prisma.offer.update({
      where: { id: offer.id },
      data: { lastCheckedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    expect(await harness.offerIntegrity.dueForRecheck(inst.id)).toHaveLength(1);
  });
});

describe('offers on an application', () => {
  it('refuses to attach an offer the student does not qualify for', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, {
      offerKey: 'country-award',
      programKey: program.programKey,
      conditions: [nationalityCondition],
    });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);

    await expect(
      harness.offerLifecycle.attach(access, app.id, 'country-award'),
    ).rejects.toThrow(/do not meet the conditions/i);
  });

  it('refuses to attach a lapsed offer', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, {
      programKey: program.programKey,
      validUntil: new Date(Date.now() + 60_000),
    });
    const access = await student();
    const app = await application(access, program.programKey, intake.id);

    await expect(
      harness.offerLifecycle.attach(
        access,
        app.id,
        'merit-award',
        new Date(Date.now() + 120_000),
      ),
    ).rejects.toThrow(/not currently available/i);
  });

  it('walks attached → accepted → realised and refuses the shortcut', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });
    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');

    await expect(
      harness.offerLifecycle.transition(toAuditActor(opsUser()), app.id, 'merit-award', 'realised'),
    ).rejects.toThrow(/cannot become realised/i);

    await harness.offerLifecycle.respond(access, app.id, 'merit-award', 'accepted');
    expect(await harness.offerLifecycle.realiseAtEnrolment(app.id)).toBe(1);

    const attachment = await prisma.applicationOffer.findFirst({
      where: { applicationId: app.id },
    });
    expect(attachment!.state).toBe('realised');
    expect(attachment!.realisedAt).not.toBeNull();
  });

  it('counts only verified offers realised at enrolment in the savings report', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });
    await liveOffer(inst.id, {
      offerKey: 'fee-waiver',
      name: 'Fee waiver',
      type: 'application_fee_waiver',
      appliesTo: 'application_fee',
      value: { kind: 'full_waiver' },
      programKey: program.programKey,
    });

    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    await harness.offerLifecycle.attach(access, app.id, 'fee-waiver');

    // Accepted but not enrolled — worth nothing to the metric.
    await harness.offerLifecycle.respond(access, app.id, 'fee-waiver', 'accepted');
    let report = await harness.offerLifecycle.savingsReport({ studentId: access.userId });
    expect(report.realisedCount).toBe(0);

    await harness.offerLifecycle.respond(access, app.id, 'merit-award', 'accepted');
    await harness.offerLifecycle.realiseAtEnrolment(app.id);

    report = await harness.offerLifecycle.savingsReport({ studentId: access.userId });
    expect(report.realisedCount).toBe(2);
    const gbp = report.byCurrency.find((entry) => entry.currency === 'GBP')!;
    // 10% of £24,000 tuition, plus the £50 application fee.
    expect(formatMoney(gbp.total)).toBe(formatMoney(money(245_000, 'GBP')));
  });

  it('keeps the admission offer in its own place, with its own words', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });
    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');

    await harness.offerLifecycle.recordAdmissionOffer(toAuditActor(opsUser()), app.id, {
      kind: 'conditional',
      conditions: [
        { summary: 'Achieve an overall IELTS of 6.5 with no band below 6.0.', met: false, evidence: null },
      ],
      issuedAt: new Date().toISOString(),
      respondByAt: new Date(Date.now() + YEAR / 12).toISOString(),
      externalRef: 'UNI-OFFER-88',
    });

    const view = await harness.offerLifecycle.forApplication(access, app.id);

    // One scholarship. One admission decision. Two different things, in two
    // different fields, with no shared vocabulary between them.
    expect(view.offers).toHaveLength(1);
    expect(view.offers[0]!.type).toBe('tuition_discount');
    expect(view.admissionOffer!.kind).toBe('conditional');
    expect(view.admissionOffer!.summary).toMatch(/1 condition still to meet/);
    expect(view.admissionOffer).not.toHaveProperty('value');
  });

  it('records the admission offer and realises savings from the university\'s own events', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });
    const access = await student();
    const app = await application(access, program.programKey, intake.id);
    await harness.offerLifecycle.attach(access, app.id, 'merit-award');
    await harness.offerLifecycle.respond(access, app.id, 'merit-award', 'accepted');

    const connector = await prisma.connectorConfig.create({
      data: {
        institutionId: inst.id,
        type: 'api',
        displayName: 'University of Example direct API',
        endpointUrl: 'https://partner.example/applications',
        credentialRef: 'partner-api',
        enabled: true,
      },
    });
    await prisma.application.update({
      where: { id: app.id },
      data: {
        connectorId: connector.id,
        connectorType: 'api',
        state: 'under_review',
        externalRef: 'UNI-REF-42',
      },
    });

    await harness.inbound.apply(connector.id, {
      providerEventId: 'evt-offer',
      externalRef: 'UNI-REF-42',
      kind: 'offer_made',
      occurredAt: new Date().toISOString(),
      detail: {
        offerKind: 'conditional',
        conditions: ['Achieve an overall IELTS of 6.5.'],
        respondBy: new Date(Date.now() + YEAR / 12).toISOString(),
      },
    });

    const admission = await prisma.admissionOffer.findUnique({ where: { applicationId: app.id } });
    expect(admission!.kind).toBe('conditional');
    expect(admission!.respondByAt).not.toBeNull();

    await harness.applications.respondToOffer(access, app.id, 'accepted');
    await harness.inbound.apply(connector.id, {
      providerEventId: 'evt-enrolled',
      externalRef: 'UNI-REF-42',
      kind: 'enrolled',
      occurredAt: new Date().toISOString(),
      detail: {},
    });

    const attachment = await prisma.applicationOffer.findFirst({
      where: { applicationId: app.id },
    });
    expect(attachment!.state).toBe('realised');
    expect(attachment!.realisedAt).not.toBeNull();
  });

  it('does not fail a partner delivery over an unreadable admission payload', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    const access = await student();
    const app = await application(access, program.programKey, intake.id);

    const connector = await prisma.connectorConfig.create({
      data: {
        institutionId: inst.id,
        type: 'api',
        displayName: 'University of Example direct API',
        endpointUrl: 'https://partner.example/applications',
        credentialRef: 'partner-api',
        enabled: true,
      },
    });
    await prisma.application.update({
      where: { id: app.id },
      data: {
        connectorId: connector.id,
        connectorType: 'api',
        state: 'under_review',
        externalRef: 'UNI-REF-43',
      },
    });

    // Junk where the conditions should be, and a one-character summary — the
    // two shapes that would otherwise reach the schema and throw.
    const result = await harness.inbound.apply(connector.id, {
      providerEventId: 'evt-junk',
      externalRef: 'UNI-REF-43',
      kind: 'offer_made',
      occurredAt: new Date().toISOString(),
      detail: { conditions: [42, '', 'x', { met: true }], offerKind: 'who knows' },
    });

    // The state change stands, and the partner is told their delivery worked.
    expect(result.applied).toBe(true);
    const admission = await prisma.admissionOffer.findUnique({ where: { applicationId: app.id } });
    // Unreadable conditions are dropped, and an unreadable kind is conditional —
    // never unconditional, which would tell a student they have a confirmed
    // place on the strength of a field we did not understand.
    expect(admission!.kind).toBe('conditional');
    expect(admission!.conditions).toEqual([]);
  });

  it('does not let one student read another student\'s offers', async () => {
    const inst = await institution();
    const { program, intake } = await programme(inst.id);
    await liveOffer(inst.id, { programKey: program.programKey });

    const mine = await student('ada@example.com');
    const app = await application(mine, program.programKey, intake.id);
    const theirs = await student('grace@example.com');

    await expect(harness.offerLifecycle.forApplication(theirs, app.id)).rejects.toThrow(/not found/i);
    await expect(harness.offerLifecycle.attach(theirs, app.id, 'merit-award')).rejects.toThrow(
      /not found/i,
    );
  });
});
