-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'guide', 'university_admin', 'university_staff', 'trust_agent', 'ops', 'finance', 'superadmin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('guide_access', 'document_share', 'university_submission', 'marketing_contact');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'system', 'connector');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('in_flight', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('unverified', 'pending', 'verified', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "VerificationStage" AS ENUM ('legal_entity_check', 'official_domain_confirmation', 'partner_contact_confirmation', 'signed_contract', 'active');

-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('prospect', 'in_onboarding', 'contract_pending', 'active', 'suspended', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "PartnershipScope" AS ENUM ('catalogue_publish', 'direct_application', 'brand_use', 'guide_programme', 'offer_publication', 'scholarship_publication');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('authorised_signatory', 'admissions', 'international_office', 'technical', 'finance');

-- CreateEnum
CREATE TYPE "ChallengeMethod" AS ENUM ('dns_txt', 'email_on_domain');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('synced', 'stale', 'pending_review', 'manual', 'failed');

-- CreateEnum
CREATE TYPE "ProgramLevel" AS ENUM ('foundation', 'undergraduate', 'postgraduate_taught', 'postgraduate_research', 'doctorate', 'pathway', 'short_course');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('draft', 'in_review', 'published', 'unpublished', 'archived');

-- CreateEnum
CREATE TYPE "StudyMode" AS ENUM ('full_time', 'part_time', 'distance', 'hybrid');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('scheduled', 'open', 'closing_soon', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('academic_qualification', 'gpa_minimum', 'english_language', 'work_experience', 'portfolio', 'interview', 'age_minimum', 'nationality_restriction', 'document_required');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "ImportState" AS ENUM ('dry_run', 'committed', 'discarded');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "organisationId" TEXT,
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "mfaEnrolledAt" TIMESTAMP(3),
    "mfaSecretRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scopeId" TEXT,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "parentId" TEXT,
    "familyId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "subjectId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "noticeVersion" TEXT NOT NULL,

    CONSTRAINT "consent_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authContext" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "integrityRef" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "state" "IdempotencyState" NOT NULL DEFAULT 'in_flight',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "domains" TEXT[],
    "country" CHAR(2) NOT NULL,
    "verificationState" "VerificationState" NOT NULL DEFAULT 'unverified',
    "verificationStage" "VerificationStage",
    "brandColor" TEXT,
    "websiteUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_partnerships" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'prospect',
    "contractRef" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scopes" "PartnershipScope"[],
    "markets" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institution_partnerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campuses" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institution_contacts" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ContactRole" NOT NULL,
    "isAuthorisedSignatory" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "challengeTokenHash" TEXT,
    "challengeExpiresAt" TIMESTAMP(3),

    CONSTRAINT "institution_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_challenges" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "method" "ChallengeMethod" NOT NULL,
    "token" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "domain_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_evidence" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "stage" "VerificationStage" NOT NULL,
    "documentRef" TEXT,
    "summary" TEXT NOT NULL,
    "collectedBy" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "programKey" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "campusId" TEXT,
    "name" TEXT NOT NULL,
    "level" "ProgramLevel" NOT NULL,
    "field" TEXT NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "studyMode" "StudyMode" NOT NULL DEFAULT 'full_time',
    "description" TEXT,
    "status" "ProgramStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "syncState" "SyncState" NOT NULL DEFAULT 'pending_review',
    "sourceRef" TEXT,
    "reviewedBy" TEXT,
    "staleFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intakes" (
    "id" TEXT NOT NULL,
    "programKey" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "applicationDeadline" TIMESTAMP(3) NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'scheduled',
    "capacity" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "syncState" "SyncState" NOT NULL DEFAULT 'pending_review',
    "sourceRef" TEXT,
    "reviewedBy" TEXT,
    "staleFields" TEXT[],

    CONSTRAINT "intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "intakeId" TEXT,
    "ruleType" "RuleType" NOT NULL,
    "ruleJson" JSONB NOT NULL,
    "humanSummary" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_fees" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "intakeId" TEXT,
    "tuitionMinor" INTEGER NOT NULL,
    "tuitionCurrency" CHAR(3) NOT NULL,
    "applicationFeeMinor" INTEGER,
    "applicationFeeCurrency" CHAR(3),
    "depositMinor" INTEGER,
    "depositCurrency" CHAR(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "syncState" "SyncState" NOT NULL DEFAULT 'pending_review',
    "sourceRef" TEXT,
    "reviewedBy" TEXT,
    "staleFields" TEXT[],

    CONSTRAINT "program_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsSeen" INTEGER NOT NULL DEFAULT 0,
    "recordsChanged" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogue_imports" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileRef" TEXT NOT NULL,
    "state" "ImportState" NOT NULL DEFAULT 'dry_run',
    "diff" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedBy" TEXT,
    "committedAt" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "catalogue_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organisationId_idx" ON "users"("organisationId");

-- CreateIndex
CREATE INDEX "user_role_grants_userId_idx" ON "user_role_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_grants_userId_role_scopeId_key" ON "user_role_grants"("userId", "role", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "consent_grants_userId_scope_idx" ON "consent_grants"("userId", "scope");

-- CreateIndex
CREATE INDEX "audit_events_objectType_objectId_idx" ON "audit_events"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_correlationId_idx" ON "audit_events"("correlationId");

-- CreateIndex
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE INDEX "institutions_country_idx" ON "institutions"("country");

-- CreateIndex
CREATE INDEX "institutions_verificationState_idx" ON "institutions"("verificationState");

-- CreateIndex
CREATE INDEX "institution_partnerships_institutionId_status_idx" ON "institution_partnerships"("institutionId", "status");

-- CreateIndex
CREATE INDEX "campuses_institutionId_idx" ON "campuses"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "institution_contacts_institutionId_email_key" ON "institution_contacts"("institutionId", "email");

-- CreateIndex
CREATE INDEX "domain_challenges_institutionId_domain_idx" ON "domain_challenges"("institutionId", "domain");

-- CreateIndex
CREATE INDEX "verification_evidence_institutionId_stage_idx" ON "verification_evidence"("institutionId", "stage");

-- CreateIndex
CREATE INDEX "programs_institutionId_status_idx" ON "programs"("institutionId", "status");

-- CreateIndex
CREATE INDEX "programs_programKey_effectiveTo_idx" ON "programs"("programKey", "effectiveTo");

-- CreateIndex
CREATE INDEX "programs_status_syncState_idx" ON "programs"("status", "syncState");

-- CreateIndex
CREATE UNIQUE INDEX "programs_programKey_version_key" ON "programs"("programKey", "version");

-- CreateIndex
CREATE INDEX "intakes_programKey_applicationDeadline_idx" ON "intakes"("programKey", "applicationDeadline");

-- CreateIndex
CREATE INDEX "intakes_status_idx" ON "intakes"("status");

-- CreateIndex
CREATE INDEX "requirements_programId_idx" ON "requirements"("programId");

-- CreateIndex
CREATE INDEX "program_fees_programId_idx" ON "program_fees"("programId");

-- CreateIndex
CREATE INDEX "sync_runs_institutionId_startedAt_idx" ON "sync_runs"("institutionId", "startedAt");

-- CreateIndex
CREATE INDEX "catalogue_imports_institutionId_state_idx" ON "catalogue_imports"("institutionId", "state");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_partnerships" ADD CONSTRAINT "institution_partnerships_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institution_contacts" ADD CONSTRAINT "institution_contacts_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_challenges" ADD CONSTRAINT "domain_challenges_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_fees" ADD CONSTRAINT "program_fees_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_imports" ADD CONSTRAINT "catalogue_imports_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

