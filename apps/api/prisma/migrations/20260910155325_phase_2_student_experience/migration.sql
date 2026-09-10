-- CreateEnum
CREATE TYPE "GradeScale" AS ENUM ('gpa_4', 'gpa_5', 'percentage', 'uk_class', 'ects_grade');

-- CreateEnum
CREATE TYPE "AcademicLevel" AS ENUM ('high_school', 'diploma', 'bachelors', 'masters', 'doctorate');

-- CreateEnum
CREATE TYPE "LanguageTestName" AS ENUM ('ielts', 'toefl_ibt', 'pte', 'duolingo', 'cambridge', 'moi_waiver');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('passport', 'transcript', 'degree_certificate', 'language_test', 'personal_statement', 'reference_letter', 'cv', 'financial_evidence', 'portfolio', 'other');

-- CreateEnum
CREATE TYPE "ScanState" AS ENUM ('pending', 'clean', 'quarantined', 'failed');

-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('pass', 'fail', 'unknown', 'missing_data');

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "nationality" CHAR(2),
    "countryOfResidence" CHAR(2),
    "intendedLevel" "ProgramLevel",
    "intendedField" TEXT,
    "preferredCountries" TEXT[],
    "budgetPerYearMinor" INTEGER,
    "budgetCurrency" CHAR(3),
    "targetIntake" TEXT,
    "workExperienceMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_records" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "level" "AcademicLevel" NOT NULL,
    "institutionName" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "fieldOfStudy" TEXT NOT NULL,
    "gradeScale" "GradeScale",
    "gradeValue" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "language_tests" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "test" "LanguageTestName" NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "bands" JSONB NOT NULL DEFAULT '{}',
    "takenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "language_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "expiryAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksum" TEXT,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "scanState" "ScanState" NOT NULL DEFAULT 'pending',
    "scannedAt" TIMESTAMP(3),
    "scanDetail" TEXT,
    "uploadComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_search_documents" (
    "programKey" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" "ProgramLevel" NOT NULL,
    "discipline" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "institutionId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "institutionVerified" BOOLEAN NOT NULL DEFAULT false,
    "country" CHAR(2) NOT NULL,
    "city" TEXT,
    "durationMonths" INTEGER NOT NULL,
    "tuitionMinor" INTEGER,
    "tuitionCurrency" CHAR(3),
    "applicationFeeMinor" INTEGER,
    "intakes" TEXT[],
    "nextDeadline" TIMESTAMP(3),
    "scholarshipAvailable" BOOLEAN NOT NULL DEFAULT false,
    "discountAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "staleFields" TEXT[],
    "syncState" "SyncState" NOT NULL DEFAULT 'pending_review',
    "searchText" TEXT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_search_documents_pkey" PRIMARY KEY ("programKey")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlists" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My shortlist',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlist_items" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "programKey" TEXT NOT NULL,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shortlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_overrides" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "outcome" "CheckOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "eligibility_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_userId_key" ON "student_profiles"("userId");

-- CreateIndex
CREATE INDEX "academic_records_profileId_idx" ON "academic_records"("profileId");

-- CreateIndex
CREATE INDEX "language_tests_profileId_idx" ON "language_tests"("profileId");

-- CreateIndex
CREATE INDEX "language_tests_expiresAt_idx" ON "language_tests"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "documents_currentVersionId_key" ON "documents"("currentVersionId");

-- CreateIndex
CREATE INDEX "documents_ownerId_type_idx" ON "documents"("ownerId", "type");

-- CreateIndex
CREATE INDEX "documents_expiryAt_idx" ON "documents"("expiryAt");

-- CreateIndex
CREATE INDEX "document_versions_scanState_idx" ON "document_versions"("scanState");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE INDEX "program_search_documents_visible_level_idx" ON "program_search_documents"("visible", "level");

-- CreateIndex
CREATE INDEX "program_search_documents_visible_country_idx" ON "program_search_documents"("visible", "country");

-- CreateIndex
CREATE INDEX "program_search_documents_visible_institutionId_idx" ON "program_search_documents"("visible", "institutionId");

-- CreateIndex
CREATE INDEX "program_search_documents_visible_tuitionMinor_idx" ON "program_search_documents"("visible", "tuitionMinor");

-- CreateIndex
CREATE INDEX "program_search_documents_visible_nextDeadline_idx" ON "program_search_documents"("visible", "nextDeadline");

-- CreateIndex
CREATE INDEX "saved_searches_profileId_idx" ON "saved_searches"("profileId");

-- CreateIndex
CREATE INDEX "shortlists_profileId_idx" ON "shortlists"("profileId");

-- CreateIndex
CREATE INDEX "shortlist_items_shortlistId_idx" ON "shortlist_items"("shortlistId");

-- CreateIndex
CREATE UNIQUE INDEX "shortlist_items_shortlistId_programKey_key" ON "shortlist_items"("shortlistId", "programKey");

-- CreateIndex
CREATE INDEX "eligibility_overrides_requirementId_idx" ON "eligibility_overrides"("requirementId");

-- CreateIndex
CREATE INDEX "eligibility_overrides_institutionId_idx" ON "eligibility_overrides"("institutionId");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "language_tests" ADD CONSTRAINT "language_tests_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_overrides" ADD CONSTRAINT "eligibility_overrides_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_overrides" ADD CONSTRAINT "eligibility_overrides_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigram search over the denormalised catalogue document.
--
-- Phase 2 §3 specifies OpenSearch. This ships the `SearchIndex` port with a
-- PostgreSQL adapter behind it (see apps/api/src/search/), so the p95 budget is
-- measurable in CI without standing up a search cluster, and the OpenSearch
-- adapter is a drop-in against the same contract tests later.
--
-- Two indexes, because they answer different questions:
--   * GIN/trigram serves the fuzzy free-text term a student actually types
--     ("data sciene"), which a tsvector alone will not match.
--   * GIN/tsvector serves whole-word relevance ranking.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "program_search_documents_search_text_trgm"
  ON "program_search_documents" USING GIN ("searchText" gin_trgm_ops);

CREATE INDEX "program_search_documents_search_text_fts"
  ON "program_search_documents" USING GIN (to_tsvector('english', "searchText"));

-- Facet arrays are membership-tested, never scanned.
CREATE INDEX "program_search_documents_intakes"
  ON "program_search_documents" USING GIN ("intakes");
