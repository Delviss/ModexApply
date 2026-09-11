-- CreateEnum
CREATE TYPE "SanctionKind" AS ENUM ('warn', 'restrict', 'suspend', 'ban');

-- CreateEnum
CREATE TYPE "SanctionTargetType" AS ENUM ('guide', 'user', 'offer', 'institution');

-- CreateEnum
CREATE TYPE "SanctionReasonCode" AS ENUM ('payment_solicitation', 'guarantee_claim', 'impersonation', 'off_platform_contact', 'spam', 'harassment', 'identity_unverified', 'identity_drift', 'fraudulent_offer', 'false_institution_claim', 'repeat_violation', 'other');

-- CreateEnum
CREATE TYPE "RequirementDecision" AS ENUM ('approved', 'overridden', 'annotated');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'sms', 'in_app');

-- CreateEnum
CREATE TYPE "NotificationDeliveryState" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('service_payment', 'service_refund', 'guide_payout');

-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('pending', 'settled', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "RefundReasonCode" AS ENUM ('duplicate_charge', 'service_not_delivered', 'student_withdrew', 'pricing_error', 'goodwill', 'chargeback');

-- CreateEnum
CREATE TYPE "PayoutState" AS ENUM ('pending_approval', 'approved', 'rejected', 'paid');

-- AlterEnum
ALTER TYPE "ConsentScope" ADD VALUE 'support_access';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "stepUpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sanctions" (
    "id" TEXT NOT NULL,
    "targetType" "SanctionTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" "SanctionKind" NOT NULL,
    "reasonCode" "SanctionReasonCode" NOT NULL,
    "reason" TEXT NOT NULL,
    "caseId" TEXT,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_grants" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,

    CONSTRAINT "impersonation_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_reviews" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "decision" "RequirementDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeRuleJson" JSONB NOT NULL,
    "beforeHumanSummary" TEXT NOT NULL,
    "afterRuleJson" JSONB,
    "afterHumanSummary" TEXT,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKey" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "state" "NotificationDeliveryState" NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "correlationId" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modex_transactions" (
    "id" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "state" "TransactionState" NOT NULL DEFAULT 'pending',
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "externalRef" TEXT,
    "subjectUserId" TEXT,
    "description" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "modex_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reasonCode" "RefundReasonCode" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "rewardEntryId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "state" "PayoutState" NOT NULL DEFAULT 'pending_approval',
    "initiatedBy" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctions_targetType_targetId_idx" ON "sanctions"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "sanctions_kind_appliedAt_idx" ON "sanctions"("kind", "appliedAt");

-- CreateIndex
CREATE INDEX "sanctions_caseId_idx" ON "sanctions"("caseId");

-- CreateIndex
CREATE INDEX "impersonation_grants_subjectId_startedAt_idx" ON "impersonation_grants"("subjectId", "startedAt");

-- CreateIndex
CREATE INDEX "impersonation_grants_operatorId_startedAt_idx" ON "impersonation_grants"("operatorId", "startedAt");

-- CreateIndex
CREATE INDEX "impersonation_grants_expiresAt_idx" ON "impersonation_grants"("expiresAt");

-- CreateIndex
CREATE INDEX "requirement_reviews_requirementId_createdAt_idx" ON "requirement_reviews"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "requirement_reviews_institutionId_createdAt_idx" ON "requirement_reviews"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_templates_key_active_idx" ON "notification_templates"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_channel_locale_version_key" ON "notification_templates"("key", "channel", "locale", "version");

-- CreateIndex
CREATE INDEX "notification_deliveries_templateKey_state_idx" ON "notification_deliveries"("templateKey", "state");

-- CreateIndex
CREATE INDEX "notification_deliveries_recipientId_queuedAt_idx" ON "notification_deliveries"("recipientId", "queuedAt");

-- CreateIndex
CREATE INDEX "modex_transactions_kind_state_idx" ON "modex_transactions"("kind", "state");

-- CreateIndex
CREATE INDEX "modex_transactions_subjectUserId_createdAt_idx" ON "modex_transactions"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "refunds_transactionId_idx" ON "refunds"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_rewardEntryId_key" ON "payouts"("rewardEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_transactionId_key" ON "payouts"("transactionId");

-- CreateIndex
CREATE INDEX "payouts_state_initiatedAt_idx" ON "payouts"("state", "initiatedAt");

-- CreateIndex
CREATE INDEX "payouts_guideId_idx" ON "payouts"("guideId");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "modex_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_rewardEntryId_fkey" FOREIGN KEY ("rewardEntryId") REFERENCES "guide_reward_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "modex_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only: the record of a review, and the record of an impersonation
-- ---------------------------------------------------------------------------
--
-- "Immutable audit on every action. No delete path, for any role" (Phase 6 §2).
--
-- `requirement_reviews` is the before/after record of a university overriding a
-- machine rule. A row that can be edited afterwards is not evidence of what was
-- decided, it is a claim about it — so the same two-layer guarantee the audit
-- log uses is installed here.
--
-- `sanctions` deliberately does NOT get this treatment: reversal writes
-- `reversedAt` on the existing row, and a sanction with no reversal path is a
-- one-way door. Its immutability lives in the audit log instead, where both the
-- sanction and its reversal are recorded.
--
-- `impersonation_grants` allows exactly one update — closing the grant — and the
-- trigger below enforces that shape rather than forbidding UPDATE outright: an
-- operator must be able to end a session early, and the sweeper must be able to
-- close an expired one, but nobody may edit who was impersonated, by whom, or
-- why, after the fact.

CREATE OR REPLACE FUNCTION requirement_reviews_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'requirement_reviews is append-only: % is not permitted (attempted on row %)',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS requirement_reviews_no_update ON requirement_reviews;
CREATE TRIGGER requirement_reviews_no_update
  BEFORE UPDATE ON requirement_reviews
  FOR EACH ROW EXECUTE FUNCTION requirement_reviews_append_only();

DROP TRIGGER IF EXISTS requirement_reviews_no_delete ON requirement_reviews;
CREATE TRIGGER requirement_reviews_no_delete
  BEFORE DELETE ON requirement_reviews
  FOR EACH ROW EXECUTE FUNCTION requirement_reviews_append_only();

DROP TRIGGER IF EXISTS requirement_reviews_no_truncate ON requirement_reviews;
CREATE TRIGGER requirement_reviews_no_truncate
  BEFORE TRUNCATE ON requirement_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION requirement_reviews_append_only();

CREATE OR REPLACE FUNCTION impersonation_grants_close_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'impersonation_grants has no delete path: % is not permitted', TG_OP
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW."operatorId" IS DISTINCT FROM OLD."operatorId"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId" THEN
    RAISE EXCEPTION 'impersonation_grants: only endedAt and endedReason may change'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Closing is one-way. Re-opening a closed grant would extend somebody's
  -- access to another person's account without a new, auditable request.
  IF OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS DISTINCT FROM OLD."endedAt" THEN
    RAISE EXCEPTION 'impersonation_grants: a closed grant cannot be reopened'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS impersonation_grants_close_only_update ON impersonation_grants;
CREATE TRIGGER impersonation_grants_close_only_update
  BEFORE UPDATE ON impersonation_grants
  FOR EACH ROW EXECUTE FUNCTION impersonation_grants_close_only();

DROP TRIGGER IF EXISTS impersonation_grants_no_delete ON impersonation_grants;
CREATE TRIGGER impersonation_grants_no_delete
  BEFORE DELETE ON impersonation_grants
  FOR EACH ROW EXECUTE FUNCTION impersonation_grants_close_only();

DROP TRIGGER IF EXISTS impersonation_grants_no_truncate ON impersonation_grants;
CREATE TRIGGER impersonation_grants_no_truncate
  BEFORE TRUNCATE ON impersonation_grants
  FOR EACH STATEMENT EXECUTE FUNCTION impersonation_grants_close_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'modex_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON requirement_reviews FROM modex_app;
    GRANT INSERT, SELECT ON requirement_reviews TO modex_app;
    REVOKE DELETE, TRUNCATE ON impersonation_grants FROM modex_app;
    GRANT INSERT, SELECT, UPDATE ON impersonation_grants TO modex_app;
  END IF;
END
$$;
