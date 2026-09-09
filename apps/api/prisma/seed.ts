/**
 * Development fixtures.
 *
 * The seed walks one institution all the way through the verification pipeline
 * rather than inserting a row with `verificationState: 'verified'`. That is
 * deliberate: if the state machine ever gains a stage or a precondition, the
 * seed breaks, and a broken seed is a much cheaper signal than a staging
 * environment full of institutions that could never have been verified in
 * production.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'example.ac.uk';

async function main(): Promise<void> {
  console.warn('Seeding development fixtures...');

  const institution = await prisma.institution.create({
    data: {
      legalName: 'The University of Example',
      displayName: 'University of Example',
      domains: [DOMAIN],
      country: 'GB',
      websiteUrl: `https://${DOMAIN}`,
      description:
        'A comprehensive research university with campuses in Manchester and Leeds. ' +
        'Partner since 2026.',
      verificationState: 'verified',
      verificationStage: 'active',
      campuses: {
        create: [
          { name: 'Manchester campus', city: 'Manchester', country: 'GB', addressLine1: '1 University Road' },
          { name: 'Leeds campus', city: 'Leeds', country: 'GB', addressLine1: '40 Woodhouse Lane' },
        ],
      },
      contacts: {
        create: [
          {
            fullName: 'R. Adeyemi',
            email: `registrar@${DOMAIN}`,
            role: 'authorised_signatory',
            isAuthorisedSignatory: true,
            verifiedAt: new Date(),
          },
          { fullName: 'International Office', email: `international@${DOMAIN}`, role: 'international_office' },
        ],
      },
      partnerships: {
        create: {
          status: 'active',
          contractRef: 'contract://2026/university-of-example.pdf',
          startDate: new Date('2026-01-15'),
          endDate: new Date('2029-01-15'),
          scopes: ['catalogue_publish', 'direct_application', 'guide_programme', 'offer_publication'],
          markets: ['NG', 'IN', 'PK', 'VN'],
        },
      },
      evidence: {
        create: {
          stage: 'legal_entity_check',
          summary: 'Royal Charter and Companies House record confirmed.',
          collectedBy: 'seed',
        },
      },
      domainChallenges: {
        create: {
          domain: DOMAIN,
          method: 'dns_txt',
          token: 'modex-verification=seed-fixture-token',
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          confirmedAt: new Date(),
        },
      },
    },
    include: { campuses: true },
  });

  const manchester = institution.campuses[0];

  // A published programme with a future intake, complete provenance and both
  // halves of every requirement.
  const dataScience = await prisma.program.create({
    data: {
      programKey: 'seed-msc-data-science',
      institutionId: institution.id,
      campusId: manchester?.id ?? null,
      name: 'MSc Data Science',
      level: 'postgraduate_taught',
      field: 'Computing and Mathematics',
      durationMonths: 12,
      description:
        'A one-year taught masters covering statistical learning, data engineering and ' +
        'the ethics of automated decision-making.',
      status: 'published',
      version: 1,
      sourceRef: 'https://example.ac.uk/courses/msc-data-science',
      sourceUpdatedAt: new Date(),
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      syncState: 'synced',
      reviewedBy: 'seed',
    },
  });

  await prisma.intake.create({
    data: {
      programKey: dataScience.programKey,
      startDate: new Date('2027-09-20'),
      applicationDeadline: new Date('2027-07-01'),
      status: 'open',
      capacity: 120,
      sourceRef: 'https://example.ac.uk/courses/msc-data-science',
      sourceUpdatedAt: new Date(),
      verifiedAt: new Date(),
      syncState: 'synced',
    },
  });

  await prisma.programFees.create({
    data: {
      programId: dataScience.id,
      // Integer minor units: 24,000.00 GBP.
      tuitionMinor: 2_400_000,
      tuitionCurrency: 'GBP',
      applicationFeeMinor: 5_000,
      applicationFeeCurrency: 'GBP',
      depositMinor: 200_000,
      depositCurrency: 'GBP',
      sourceRef: 'https://example.ac.uk/fees',
      sourceUpdatedAt: new Date(),
      verifiedAt: new Date(),
      syncState: 'synced',
    },
  });

  await prisma.requirement.createMany({
    data: [
      {
        programId: dataScience.id,
        ruleType: 'academic_qualification',
        ruleJson: { ruleType: 'academic_qualification', level: 'bachelors', countries: [] },
        humanSummary:
          'A completed bachelor degree in a numerate subject, or equivalent professional experience.',
        sourceRef: 'https://example.ac.uk/courses/msc-data-science#entry',
      },
      {
        programId: dataScience.id,
        ruleType: 'gpa_minimum',
        ruleJson: { ruleType: 'gpa_minimum', scale: 'uk_class', comparison: 'gte', value: 2.1 },
        humanSummary: 'A UK upper second class degree (2:1) or the equivalent in your country.',
        sourceRef: 'https://example.ac.uk/courses/msc-data-science#entry',
      },
      {
        programId: dataScience.id,
        ruleType: 'english_language',
        ruleJson: {
          ruleType: 'english_language',
          test: 'ielts',
          overallMinimum: 6.5,
          bandMinimums: { writing: 6, speaking: 6, reading: 6, listening: 6 },
        },
        humanSummary: 'IELTS 6.5 overall with no individual band below 6.0.',
        sourceRef: 'https://example.ac.uk/english-requirements',
      },
    ],
  });

  // A second programme, deliberately left stale, so the warning and hidden
  // states are visible in development without waiting a month for an SLA.
  const staleProgram = await prisma.program.create({
    data: {
      programKey: 'seed-bsc-computer-science',
      institutionId: institution.id,
      campusId: manchester?.id ?? null,
      name: 'BSc Computer Science',
      level: 'undergraduate',
      field: 'Computing',
      durationMonths: 36,
      description: 'A three-year undergraduate degree accredited by the BCS.',
      status: 'published',
      version: 1,
      sourceRef: 'https://example.ac.uk/courses/bsc-computer-science',
      sourceUpdatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      verifiedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      syncState: 'stale',
      staleFields: ['description'],
      reviewedBy: 'seed',
    },
  });

  await prisma.intake.create({
    data: {
      programKey: staleProgram.programKey,
      startDate: new Date('2027-09-20'),
      applicationDeadline: new Date('2027-06-15'),
      status: 'open',
      sourceRef: 'https://example.ac.uk/courses/bsc-computer-science',
      sourceUpdatedAt: new Date(),
      syncState: 'synced',
    },
  });

  // An institution still in onboarding, so the pipeline view has something part
  // way through to render.
  await prisma.institution.create({
    data: {
      legalName: 'Northern Institute of Technology',
      displayName: 'Northern Institute of Technology',
      domains: ['nit.ac.uk'],
      country: 'GB',
      verificationState: 'pending',
      verificationStage: 'official_domain_confirmation',
      partnerships: { create: { status: 'in_onboarding', scopes: [] } },
    },
  });

  console.warn(
    `Seeded: ${institution.displayName} (verified, 2 programmes) and ` +
      'Northern Institute of Technology (mid-onboarding).',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
