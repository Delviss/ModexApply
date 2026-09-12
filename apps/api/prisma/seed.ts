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

  // A student, so the dashboard, profile and vault have somebody to be about.
  // Deliberately half-complete: an empty profile shows every gap and a full one
  // shows none, and neither exercises the "some of this is missing" states that
  // are most of what these surfaces do.
  const student = await prisma.user.create({
    data: {
      email: 'ada@example.com',
      displayName: 'Ada Bello',
      status: 'active',
      emailVerifiedAt: new Date(),
      roles: { create: { role: 'student' } },
      studentProfile: {
        create: {
          nationality: 'NG',
          countryOfResidence: 'NG',
          dateOfBirth: new Date('2003-04-11'),
          intendedLevel: 'postgraduate_taught',
          intendedField: 'Computer Science',
          preferredCountries: ['GB'],
          targetIntake: '2027-09',
          academicRecords: {
            create: {
              level: 'bachelors',
              institutionName: 'University of Lagos',
              countryCode: 'NG',
              fieldOfStudy: 'Computer Science',
              gradeScale: 'gpa_4',
              gradeValue: 3.5,
              startedAt: new Date('2021-09-01'),
              completedAt: new Date('2025-07-01'),
            },
          },
        },
      },
    },
  });

  // One document per interesting scan state, so the vault renders all of them
  // without waiting on a real scanner.
  const transcript = await prisma.document.create({
    data: { ownerId: student.id, type: 'transcript', displayName: 'Transcript.pdf' },
  });
  const cleanVersion = await prisma.documentVersion.create({
    data: {
      documentId: transcript.id,
      version: 1,
      objectKey: 'documents/seed/transcript-v1',
      checksum: 'a'.repeat(64),
      sizeBytes: 182_311,
      contentType: 'application/pdf',
      scanState: 'clean',
      scannedAt: new Date(),
      uploadComplete: true,
    },
  });
  await prisma.document.update({
    where: { id: transcript.id },
    data: { currentVersionId: cleanVersion.id },
  });

  const passport = await prisma.document.create({
    data: {
      ownerId: student.id,
      type: 'passport',
      displayName: 'Passport.pdf',
      // Inside the 90-day warning window, so the expiry state is visible in
      // development without waiting three months for it.
      expiryAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
    },
  });
  const quarantined = await prisma.documentVersion.create({
    data: {
      documentId: passport.id,
      version: 1,
      objectKey: 'documents/seed/passport-v1',
      checksum: 'b'.repeat(64),
      sizeBytes: 90_112,
      contentType: 'application/pdf',
      scanState: 'quarantined',
      scanDetail: 'Malware signature: Eicar-Test-Signature',
      scannedAt: new Date(),
      uploadComplete: true,
    },
  });
  await prisma.document.update({
    where: { id: passport.id },
    data: { currentVersionId: quarantined.id },
  });


  // ---------------------------------------------------------------------------
  // Phase 3 — the guide network (#5)
  // ---------------------------------------------------------------------------
  //
  // Three guides in three states, because the interesting surfaces are the ones
  // that are not "everything is fine": an active guide, one whose evidence is
  // inside the 30-day warning window, and one already restricted. The directory
  // shows exactly one of them, which is the point.
  async function seedGuide(input: {
    email: string;
    displayName: string;
    languages: string[];
    homeCountry: string;
    topics: ('accommodation' | 'cost_of_living' | 'campus_life' | 'coursework' | 'part_time_work')[];
    bio: string;
    expiresInDays: number | null;
    state: 'active' | 'restricted';
  }) {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        status: 'active',
        emailVerifiedAt: new Date(),
        roles: { create: { role: 'guide' } },
      },
    });

    const expiresAt =
      input.expiresInDays === null
        ? null
        : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    return prisma.studentGuide.create({
      data: {
        userId: user.id,
        institutionId: institution.id,
        campusId: manchester?.id ?? null,
        programKey: dataScience.programKey,
        level: 'postgraduate_taught',
        yearOfStudy: 2,
        languages: input.languages,
        homeCountry: input.homeCountry,
        topics: input.topics,
        bio: input.bio,
        state: input.state,
        stage: 'active',
        verifiedAt: new Date(),
        evidenceExpiresAt: expiresAt,
        trustScore: 72,
        responseTimeHours: 5,
        lastSeenAt: new Date(),
        verifications: {
          create: {
            evidenceType: 'university_domain_email',
            summary: `Challenge confirmed on an address at ${DOMAIN}.`,
            verifiedAt: new Date(),
            expiresAt,
          },
        },
      },
    });
  }

  const activeGuide = await seedGuide({
    email: `amara@${DOMAIN}`,
    displayName: 'Amara Chidinma Okonkwo',
    languages: ['English', 'Yoruba'],
    homeCountry: 'NG',
    topics: ['accommodation', 'cost_of_living', 'coursework'],
    bio: 'Second year on the MSc. I moved from Lagos in 2025 and lived in the older halls for a year, so I can tell you what they are actually like.',
    expiresInDays: 120,
    state: 'active',
  });

  await seedGuide({
    email: `bilal@${DOMAIN}`,
    displayName: 'Bilal Ahmed',
    languages: ['English', 'Urdu'],
    homeCountry: 'PK',
    topics: ['part_time_work', 'campus_life'],
    // Inside the warning window, so the dashboard countdown renders amber in
    // development without waiting five months for it.
    bio: 'I work in the library ten hours a week and can talk about balancing that with the course.',
    expiresInDays: 12,
    state: 'active',
  });

  await seedGuide({
    email: `chen@${DOMAIN}`,
    displayName: 'Chen Wei',
    languages: ['English', 'Mandarin'],
    homeCountry: 'CN',
    topics: ['campus_life'],
    bio: 'Third year. Ask me about societies.',
    // Already lapsed: restricted, out of the directory, conversations intact.
    expiresInDays: -3,
    state: 'restricted',
  });

  // Two free slots and one already taken, so the booking calendar shows both
  // states without anybody having to book anything first.
  const slotStart = (days: number, hour: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(hour, 0, 0, 0);
    return date;
  };
  for (const [days, hour, booked] of [
    [3, 15, 0],
    [3, 16, 1],
    [5, 10, 0],
  ] as const) {
    await prisma.guideAvailabilitySlot.create({
      data: {
        guideId: activeGuide.id,
        startsAt: slotStart(days, hour),
        endsAt: new Date(slotStart(days, hour).getTime() + 30 * 60 * 1000),
        topics: ['accommodation'],
        capacity: 1,
        booked,
      },
    });
  }

  // A published answer, which needed both a moderator's yes and the guide's.
  const question = await prisma.guideQuestion.create({
    data: {
      institutionId: institution.id,
      topic: 'accommodation',
      body: 'How much is a room in halls, and are bills included?',
    },
  });
  await prisma.guideAnswer.create({
    data: {
      questionId: question.id,
      guideId: activeGuide.id,
      body: 'I paid about £140 a week in the older halls with bills and wifi included. The newer blocks are closer to £190. Both are self-catered, and the kitchens are shared between six.',
      state: 'published',
      guideConsentedAt: new Date(),
      moderatedAt: new Date(),
      moderatedBy: 'seed',
      publishedAt: new Date(),
      helpfulCount: 12,
    },
  });

  // -------------------------------------------------------------------------
  // Phase 5 — offers.
  //
  // Four, chosen to make every state of the price panel visible on a clean
  // clone: one the seeded student qualifies for, one they do not (with the
  // reason), one that cannot combine with the first, and one benefit that is
  // deliberately worth nothing to the arithmetic.
  // -------------------------------------------------------------------------
  const verifiedBy = 'A. Okafor, Modex Trust';
  const offerDefaults = {
    institutionId: institution.id,
    publicationState: 'published' as const,
    verificationState: 'verified' as const,
    verifiedBy,
    verifiedAt: new Date(),
    lastCheckedAt: new Date(),
    validFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    syncState: 'synced' as const,
    reviewedBy: 'seed',
    staleFields: [],
  };

  await prisma.offer.create({
    data: {
      ...offerDefaults,
      offerKey: 'seed-international-merit-award',
      programKey: dataScience.programKey,
      type: 'scholarship',
      name: 'International Merit Award',
      valueKind: 'fixed_amount',
      // Integer minor units: 5,000.00 GBP.
      amountMinor: 500_000,
      currency: 'GBP',
      appliesTo: 'tuition',
      duration: 'first_year',
      conditions: [
        {
          id: 'seed-merit-gpa',
          ruleType: 'gpa_minimum',
          ruleJson: { ruleType: 'gpa_minimum', scale: 'gpa_4', comparison: 'gte', value: 3.2 },
          humanSummary: 'A grade point average of 3.2 or above on a 4.0 scale.',
          sourceRef: 'https://example.ac.uk/fees/international-merit-award',
        },
      ],
      termsSummary:
        'Awarded on academic merit to international fee-payers. Applies to the first year of tuition only.',
      applicationMethod: 'No separate form — we attach it to your application when you qualify.',
      claimDeadline: new Date('2027-05-31'),
      validUntil: new Date('2027-06-30'),
      sourceRef: 'https://example.ac.uk/fees/international-merit-award',
      exclusions: {
        create: [
          {
            kind: 'not_combinable_with_offer',
            otherOfferKey: 'seed-early-payment-discount',
            programKeys: [],
            humanSummary: 'Not combinable with the early payment discount.',
          },
        ],
      },
    },
  });

  await prisma.offer.create({
    data: {
      ...offerDefaults,
      offerKey: 'seed-early-payment-discount',
      programKey: dataScience.programKey,
      type: 'tuition_discount',
      name: 'Early payment discount',
      valueKind: 'percentage',
      // 5%, in basis points. There is nowhere here to write "5%" as text.
      basisPoints: 500,
      appliesTo: 'tuition',
      duration: 'first_year',
      conditions: [
        {
          id: 'seed-early-payment-degree',
          ruleType: 'academic_qualification',
          ruleJson: { ruleType: 'academic_qualification', level: 'bachelors', countries: [] },
          humanSummary: 'A completed bachelor degree.',
          sourceRef: 'https://example.ac.uk/fees/early-payment',
        },
      ],
      termsSummary: 'For students who pay the first year in full before enrolment.',
      validUntil: new Date('2027-08-31'),
      sourceRef: 'https://example.ac.uk/fees/early-payment',
      exclusions: {
        create: [
          {
            kind: 'requires_full_upfront_payment',
            programKeys: [],
            humanSummary: 'You must pay the whole first year before you enrol to keep this.',
          },
          {
            kind: 'not_combinable_with_offer',
            otherOfferKey: 'seed-international-merit-award',
            programKeys: [],
            humanSummary: 'Not combinable with the International Merit Award.',
          },
        ],
      },
    },
  });

  await prisma.offer.create({
    data: {
      ...offerDefaults,
      offerKey: 'seed-south-asia-award',
      programKey: null,
      type: 'scholarship',
      name: 'South Asia Regional Award',
      valueKind: 'percentage',
      basisPoints: 1500,
      appliesTo: 'tuition',
      duration: 'every_year',
      conditions: [
        {
          id: 'seed-south-asia-nationality',
          ruleType: 'nationality_restriction',
          ruleJson: {
            ruleType: 'nationality_restriction',
            comparison: 'in',
            countries: ['IN', 'PK', 'BD', 'LK', 'NP'],
          },
          humanSummary:
            'Open to nationals of India, Pakistan, Bangladesh, Sri Lanka and Nepal.',
          sourceRef: 'https://example.ac.uk/fees/south-asia-award',
        },
      ],
      termsSummary: 'A regional award for students from South Asia, renewed each year on progression.',
      applicationMethod: 'Apply on the university site by the deadline below.',
      // Inside the 14-day warning window on a clean clone, so the amber
      // treatment is visible without editing a date by hand — and the claim
      // deadline sits inside it rather than beyond it, because an award you are
      // told to apply for after it has closed is the contradiction the
      // publication gate now refuses.
      claimDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      sourceRef: 'https://example.ac.uk/fees/south-asia-award',
    },
  });

  await prisma.offer.create({
    data: {
      ...offerDefaults,
      offerKey: 'seed-guaranteed-housing',
      programKey: null,
      type: 'student_benefit',
      name: 'Guaranteed first-year housing',
      valueKind: 'benefit_in_kind',
      benefit: 'A guaranteed place in university halls for the first year',
      provider: 'University of Example Accommodation Services',
      // A benefit reduces no cost line, and contributes nothing to the net
      // price. Giving it a notional cash value is the arithmetic Phase 5 exists
      // to refuse.
      appliesTo: 'none',
      duration: 'first_year',
      conditions: [
        {
          id: 'seed-housing-qualification',
          ruleType: 'academic_qualification',
          ruleJson: { ruleType: 'academic_qualification', level: 'bachelors', countries: [] },
          humanSummary: 'A completed bachelor degree.',
          sourceRef: 'https://example.ac.uk/accommodation/guarantee',
        },
      ],
      termsSummary: 'Applies to applications made before the intake deadline.',
      redemptionMethod: 'Accept your place, then apply for halls with the code we send you.',
      validUntil: new Date('2027-07-31'),
      sourceRef: 'https://example.ac.uk/accommodation/guarantee',
    },
  });

  console.warn(
    `Seeded: ${institution.displayName} (verified, 2 programmes), ` +
      'Northern Institute of Technology (mid-onboarding), and ' +
      `${student.displayName} (part-complete profile, one clean and one quarantined document), ` +
      'plus three student guides (active, expiring, restricted), three session slots, ' +
      'one published Q&A answer, and four verified offers (one the student ' +
      'qualifies for, one they do not, one non-combinable, one benefit in kind).',
  );
  console.warn(
    'Run `pnpm --filter @modex/api exec tsx prisma/reindex.ts` to build the search index.',
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
