-- Phase 8 — document assessment (#20).
--
-- Purely additive: two enums, one table, its indexes. No column is dropped,
-- retyped or made NOT NULL, so the release before this one runs unchanged
-- against the new schema for the length of a rolling deploy.

-- CreateEnum
CREATE TYPE "AssessmentDecision" AS ENUM ('accepted', 'more_information', 'rejected');

-- CreateEnum
CREATE TYPE "AssessmentReason" AS ENUM ('illegible', 'incomplete', 'wrong_document', 'expired', 'untranslated', 'uncertified', 'mismatched_identity', 'suspected_alteration');

-- CreateTable
CREATE TABLE "document_assessments" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "institutionId" TEXT,
    "applicationId" TEXT,
    "openedAt" TIMESTAMP(3),
    "openedById" TEXT,
    "decision" "AssessmentDecision",
    "reasons" "AssessmentReason"[] DEFAULT ARRAY[]::"AssessmentReason"[],
    "note" TEXT,
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "trustCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- The partial-free unique index is deliberate. Postgres treats NULLs as
-- distinct, so several Modex-side assessments (institutionId IS NULL) of one
-- version would be allowed by this constraint alone; the service holds that
-- rule instead, because the alternative — a sentinel institution id — would put
-- a fake row in the institutions table to satisfy an index.
CREATE UNIQUE INDEX "document_assessments_documentVersionId_institutionId_key" ON "document_assessments"("documentVersionId", "institutionId");

-- CreateIndex
CREATE INDEX "document_assessments_decision_createdAt_idx" ON "document_assessments"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "document_assessments_studentId_idx" ON "document_assessments"("studentId");

-- CreateIndex
CREATE INDEX "document_assessments_institutionId_decision_idx" ON "document_assessments"("institutionId", "decision");

-- AddForeignKey
ALTER TABLE "document_assessments" ADD CONSTRAINT "document_assessments_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assessments" ADD CONSTRAINT "document_assessments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assessments" ADD CONSTRAINT "document_assessments_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
