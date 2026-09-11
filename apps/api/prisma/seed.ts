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
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { MfaService } from '../src/auth/mfa.service.js';
import { loadEnv } from '../src/config/env.js';

const prisma = new PrismaClient();

const DOMAIN = 'example.ac.uk';

/**
 * Development credentials.
 *
 * Every seeded account signs in with the same password and, for staff, the same
 * TOTP secret. Both are printed at the end of the seed and both are useless
 * anywhere real: the password fails the policy nowhere, but the secret is
 * sealed with `MFA_SECRET_KEY`, and no deployed environment shares the local
 * development key.
 *
 * Before this, every seeded user had a null `passwordHash` — the fixtures
 * described a platform nobody could sign in to.
 */
const DEV_PASSWORD = 'ModexDev!Passw0rd';

/** A fixed base32 secret, so `oathtool --totp -b <secret>` produces a working code. */
const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const mfa = new MfaService(loadEnv().MFA_SECRET_KEY);

async function main(): Promise<void> {
  console.warn('Seeding development fixtures...');

  const passwordHash = await argon2.hash(DEV_PASSWORD);
  const sealedSecret = mfa.seal(DEV_TOTP_SECRET);

  /**
   * A staff account, enrolled in MFA.
   *
   * Staff roles cannot sign in without a second factor — that is the Phase 0
   * rule and Phase 6 depends on it — so the seed enrols one rather than leaving
   * every console unreachable in development.
   */
  async function staff(input: {
    email: string;
    displayName: string;
    role: Role;
    organisationId?: string;
  }) {
    return prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        status: 'active',
        emailVerifiedAt: new Date(),
        passwordHash,
        mfaEnrolledAt: new Date(),
        mfaSecretRef: sealedSecret,
        organisationId: input.organisationId ?? null,
        roles: {
          create: { role: input.role, scopeId: input.organisationId ?? null },
        },
      },
    });
  }

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
      passwordHash,
      roles: { create: { role: 'student' } },
      consents: {
        create: {
          // So the Phase 6 support-impersonation flow is demonstrable without
          // hand-inserting a consent row. Revoking it from the privacy page
          // ends support access on the operator's next request.
          scope: 'support_access',
          noticeVersion: 'support-access-v1',
        },
      },
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
        passwordHash,
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
      claimDeadline: new Date('2027-04-30'),
      // Inside the 14-day warning window on a clean clone, so the amber
      // treatment is visible without editing a date by hand.
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

  // -------------------------------------------------------------------------
  // Phase 6 — the four consoles need people to open them
  // -------------------------------------------------------------------------

  const registrar = await staff({
    email: `admin@${DOMAIN}`,
    displayName: 'R. Adeyemi (Registrar)',
    role: 'university_admin',
    organisationId: institution.id,
  });
  await staff({
    email: `admissions@${DOMAIN}`,
    displayName: 'J. Ferreira (Admissions)',
    role: 'university_staff',
    organisationId: institution.id,
  });
  await staff({ email: 'trust@modex.test', displayName: 'M. Haddad (Trust)', role: 'trust_agent' });
  await staff({ email: 'ops@modex.test', displayName: 'S. Nowak (Operations)', role: 'ops' });

  // Two finance accounts, deliberately. One cannot demonstrate the rule that a
  // high-value payout needs a second actor, and a rule nobody can see working
  // is a rule somebody eventually removes.
  await staff({ email: 'finance1@modex.test', displayName: 'T. Okafor (Finance)', role: 'finance' });
  await staff({ email: 'finance2@modex.test', displayName: 'L. Marchetti (Finance)', role: 'finance' });

  // A completed session and the reward it earned, so the finance queue has a
  // payout to start. The amount is over the dual-approval threshold on purpose.
  const completedSession = await prisma.guideSession.create({
    data: {
      studentId: student.id,
      guideId: activeGuide.id,
      channel: 'video',
      scheduledFor: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      durationMinutes: 30,
      status: 'completed',
      completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      topics: ['accommodation'],
      rewardState: 'earned',
    },
  });
  await prisma.guideRewardEntry.create({
    data: {
      guideId: activeGuide.id,
      sessionId: completedSession.id,
      kind: 'fixed_stipend',
      state: 'earned',
      amountMinor: 25_000,
      currency: 'GBP',
      earnedAt: new Date(),
      note: 'Session delivered. Nothing here depends on whether the student was admitted.',
    },
  });

  // A service payment, so the refund path has something legitimate to run
  // against — and nothing resembling tuition, which Modex never holds.
  await prisma.modexTransaction.create({
    data: {
      kind: 'service_payment',
      state: 'settled',
      amountMinor: 4_900,
      currency: 'GBP',
      externalRef: 'dev-payment-0001',
      subjectUserId: student.id,
      description: 'Modex application support — one-off service fee',
      correlationId: 'seed',
      settledAt: new Date(),
    },
  });

  await prisma.notificationTemplate.createMany({
    data: [
      {
        key: 'application.submitted',
        channel: 'email',
        locale: 'en',
        subject: 'Your application has reached {{institutionName}}',
        body:
          'Hello {{studentName}},\n\n{{institutionName}} has your application for {{programName}}. ' +
          'Your reference is {{applicationRef}}.\n\nYou can follow it at {{supportUrl}}.',
        updatedBy: registrar.id,
      },
      {
        key: 'document.quarantined',
        channel: 'email',
        locale: 'en',
        subject: 'One of your documents could not be accepted',
        body:
          'Hello {{studentName}},\n\nA file you uploaded did not pass our safety scan and has not ' +
          'been shared with anyone. Upload a replacement at {{supportUrl}}.',
        updatedBy: registrar.id,
      },
    ],
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
  console.warn(
    [
      '',
      'Development sign-in:',
      `  password for every account: ${DEV_PASSWORD}`,
      `  staff TOTP secret (base32): ${DEV_TOTP_SECRET}`,
      '    → oathtool --totp -b ' + DEV_TOTP_SECRET,
      '',
      '  student            ada@example.com',
      `  university admin   admin@${DOMAIN}        → /admin/university`,
      `  university staff   admissions@${DOMAIN}`,
      '  trust agent        trust@modex.test        → /admin/trust',
      '  operations         ops@modex.test          → /admin/ops',
      '  finance (two)      finance1@modex.test, finance2@modex.test → /admin/finance',
      '',
      'Staff accounts need the six-digit code at sign-in and again on entering a console.',
    ].join('\n'),
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
