-- Phase 5 — offers, scholarships, discounts and fee waivers (#7).
--
-- Purely additive: no column is dropped, no type is changed and no constraint is
-- removed, so a running Phase 4 release keeps working while this applies.
--
-- The hand-written part is at the bottom, and it is the half that matters. The
-- issue's rule — "offers are structured objects, not marketing copy" — is only
-- true if the database refuses the unstructured cases, so there are CHECK
-- constraints for:
--
--   * a percentage with no percentage, and a cash award with no currency;
--   * a published offer with no source, no verifier or no last-checked date;
--   * a validity window that ends before it starts.
--
-- Without them "verified offer" would mean "an offer some service remembered to
-- validate", which is the same thing as nothing.

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('scholarship', 'tuition_discount', 'application_fee_waiver', 'deposit_incentive', 'student_benefit');

-- CreateEnum
CREATE TYPE "OfferValueKind" AS ENUM ('percentage', 'fixed_amount', 'full_waiver', 'benefit_in_kind');

-- CreateEnum
CREATE TYPE "OfferBase" AS ENUM ('tuition', 'application_fee', 'deposit', 'none');

-- CreateEnum
CREATE TYPE "OfferDuration" AS ENUM ('one_off', 'first_year', 'every_year');

-- CreateEnum
CREATE TYPE "OfferPublicationState" AS ENUM ('draft', 'in_review', 'published', 'unpublished', 'expired');

-- CreateEnum
CREATE TYPE "OfferExclusionKind" AS ENUM ('not_combinable_with_offer', 'not_combinable_with_type', 'first_year_only', 'new_students_only', 'requires_full_upfront_payment', 'excludes_programmes');

-- CreateEnum
CREATE TYPE "OfferAttachmentState" AS ENUM ('attached', 'accepted', 'declined', 'expired', 'realised', 'superseded');

-- CreateEnum
CREATE TYPE "AdmissionOfferKind" AS ENUM ('conditional', 'unconditional');

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "programKey" TEXT,
    "type" "OfferType" NOT NULL,
    "name" TEXT NOT NULL,
    "valueKind" "OfferValueKind" NOT NULL,
    "basisPoints" INTEGER,
    "amountMinor" INTEGER,
    "currency" CHAR(3),
    "benefit" TEXT,
    "provider" TEXT,
    "appliesTo" "OfferBase" NOT NULL,
    "duration" "OfferDuration" NOT NULL DEFAULT 'first_year',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "termsSummary" TEXT,
    "applicationMethod" TEXT,
    "redemptionMethod" TEXT,
    "claimDeadline" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "publicationState" "OfferPublicationState" NOT NULL DEFAULT 'draft',
    "unpublishedAt" TIMESTAMP(3),
    "unpublishedReason" TEXT,
    "verificationState" "VerificationState" NOT NULL DEFAULT 'unverified',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "syncState" "SyncState" NOT NULL DEFAULT 'pending_review',
    "sourceRef" TEXT,
    "reviewedBy" TEXT,
    "staleFields" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_exclusions" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" "OfferExclusionKind" NOT NULL,
    "otherOfferKey" TEXT,
    "otherOfferType" "OfferType",
    "programKeys" TEXT[],
    "humanSummary" TEXT NOT NULL,

    CONSTRAINT "offer_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_source_checks" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedBy" TEXT,
    "sourceRef" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "observed" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "trustCaseId" TEXT,

    CONSTRAINT "offer_source_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_offers" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "state" "OfferAttachmentState" NOT NULL DEFAULT 'attached',
    "valueKind" "OfferValueKind" NOT NULL,
    "basisPoints" INTEGER,
    "amountMinor" INTEGER,
    "currency" CHAR(3),
    "savingMinor" INTEGER,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "realisedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "application_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_offers" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" "AdmissionOfferKind" NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "respondByAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offers_offerKey_version_key" ON "offers"("offerKey", "version");

-- CreateIndex
CREATE INDEX "offers_institutionId_publicationState_idx" ON "offers"("institutionId", "publicationState");

-- CreateIndex
CREATE INDEX "offers_offerKey_effectiveTo_idx" ON "offers"("offerKey", "effectiveTo");

-- CreateIndex
CREATE INDEX "offers_programKey_publicationState_idx" ON "offers"("programKey", "publicationState");

-- CreateIndex
CREATE INDEX "offers_publicationState_validUntil_idx" ON "offers"("publicationState", "validUntil");

-- CreateIndex
CREATE INDEX "offer_exclusions_offerId_idx" ON "offer_exclusions"("offerId");

-- CreateIndex
CREATE INDEX "offer_source_checks_offerId_checkedAt_idx" ON "offer_source_checks"("offerId", "checkedAt");

-- CreateIndex
CREATE INDEX "offer_source_checks_matched_idx" ON "offer_source_checks"("matched");

-- CreateIndex
CREATE UNIQUE INDEX "application_offers_applicationId_offerKey_key" ON "application_offers"("applicationId", "offerKey");

-- CreateIndex
CREATE INDEX "application_offers_applicationId_state_idx" ON "application_offers"("applicationId", "state");

-- CreateIndex
CREATE INDEX "application_offers_offerId_idx" ON "application_offers"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_applicationId_key" ON "admission_offers"("applicationId");

-- CreateIndex
CREATE INDEX "admission_offers_respondByAt_idx" ON "admission_offers"("respondByAt");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_exclusions" ADD CONSTRAINT "offer_exclusions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_source_checks" ADD CONSTRAINT "offer_source_checks_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_offers" ADD CONSTRAINT "application_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_offers" ADD CONSTRAINT "application_offers_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The hand-written half: the structure that makes "structured object" true.
-- ---------------------------------------------------------------------------

-- A value that cannot be read as a number is not a value. Each kind carries
-- exactly the columns it needs, and the ones it does not are NULL — so there is
-- no row anywhere shaped like "10% or maybe £5,000, see the terms".
ALTER TABLE "offers" ADD CONSTRAINT "offers_value_shape" CHECK (
  CASE "valueKind"
    WHEN 'percentage' THEN
      "basisPoints" IS NOT NULL AND "basisPoints" BETWEEN 1 AND 10000
      AND "amountMinor" IS NULL AND "currency" IS NULL AND "benefit" IS NULL
    WHEN 'fixed_amount' THEN
      "amountMinor" IS NOT NULL AND "amountMinor" > 0 AND "currency" IS NOT NULL
      AND "basisPoints" IS NULL AND "benefit" IS NULL
    WHEN 'full_waiver' THEN
      "basisPoints" IS NULL AND "amountMinor" IS NULL AND "benefit" IS NULL
    WHEN 'benefit_in_kind' THEN
      -- A benefit has a name and a provider and no price, and is attached to no
      -- cost line: assigning it a notional cash value is the marketing
      -- arithmetic this phase exists to end.
      "benefit" IS NOT NULL AND "provider" IS NOT NULL
      AND "basisPoints" IS NULL AND "amountMinor" IS NULL AND "appliesTo" = 'none'
  END
);

-- A validity window that ends before it starts would make `isOfferLive` false
-- for every clock, which is a silently invisible offer rather than an error.
ALTER TABLE "offers" ADD CONSTRAINT "offers_validity_window" CHECK ("validUntil" > "validFrom");

-- Acceptance criterion 1, in the schema: an offer cannot reach the published
-- state without source, eligibility, value, deadline, conditions, verifier and
-- last-checked date. The service checks the same list and returns the missing
-- items one by one; this is what makes the guarantee independent of the service.
ALTER TABLE "offers" ADD CONSTRAINT "offers_publishable" CHECK (
  "publicationState" <> 'published'
  OR (
    "sourceRef" IS NOT NULL AND length(btrim("sourceRef")) > 0
    AND "termsSummary" IS NOT NULL AND length(btrim("termsSummary")) > 0
    AND "verifiedBy" IS NOT NULL AND length(btrim("verifiedBy")) > 0
    AND "verifiedAt" IS NOT NULL
    AND "lastCheckedAt" IS NOT NULL
    AND "verificationState" = 'verified'
    AND jsonb_array_length("conditions") > 0
    AND ("type" <> 'scholarship' OR ("claimDeadline" IS NOT NULL AND "applicationMethod" IS NOT NULL))
    AND ("type" <> 'student_benefit' OR "redemptionMethod" IS NOT NULL)
  )
);

-- An exclusion that names nothing excludes nothing, and an exclusion nobody can
-- read is one that gets discovered at the worst possible moment.
ALTER TABLE "offer_exclusions" ADD CONSTRAINT "offer_exclusions_target" CHECK (
  length(btrim("humanSummary")) >= 10
  AND ("kind" <> 'not_combinable_with_offer' OR "otherOfferKey" IS NOT NULL)
  AND ("kind" <> 'not_combinable_with_type' OR "otherOfferType" IS NOT NULL)
  AND ("kind" <> 'excludes_programmes' OR array_length("programKeys", 1) >= 1)
);

-- "Savings secured" counts `realisedAt`, so the column has to mean what it says:
-- realised is a state reached at enrolment and nowhere else.
ALTER TABLE "application_offers" ADD CONSTRAINT "application_offers_realised_shape" CHECK (
  ("state" = 'realised') = ("realisedAt" IS NOT NULL)
);
