-- Phase 4 — applications, immutable snapshots and the connector layer (#6).
--
-- Purely additive: no column is dropped, no type is changed and no constraint is
-- removed, so a running Phase 3 release is unaffected while this applies.
--
-- The hand-written part is at the bottom. `application_snapshots` is append-only,
-- for the same reason `audit_events` and `message_flags` are, and for a sharper
-- one: the snapshot *is* the answer to "what was actually sent to the
-- university". A record that the process acting on it can edit answers a
-- different, useless question — "what do we currently believe was sent".

-- CreateEnum
CREATE TYPE "ApplicationState" AS ENUM ('draft', 'ready', 'submitted_pending', 'submitted', 'failed', 'under_review', 'more_info', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn', 'expired', 'enrolled');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('api', 'portal_handoff', 'deep_link', 'file_exchange', 'operator_assisted');

-- CreateEnum
CREATE TYPE "ApplicationOwner" AS ENUM ('student', 'university', 'modex_ops');

-- CreateEnum
CREATE TYPE "ApplicationTaskType" AS ENUM ('complete_profile_field', 'upload_document', 'replace_document', 'accept_consent', 'answer_question', 'pay_application_fee', 'university_review', 'provide_more_info', 'operator_submission');

-- CreateEnum
CREATE TYPE "ApplicationTaskStatus" AS ENUM ('open', 'blocked', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "SubmissionAttemptState" AS ENUM ('in_flight', 'accepted', 'awaiting_handoff', 'queued', 'rejected', 'failed', 'dead_lettered');

-- CreateEnum
CREATE TYPE "InboundStatusKind" AS ENUM ('received', 'under_review', 'more_info_required', 'offer_made', 'rejected', 'withdrawn', 'enrolled');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "programKey" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "state" "ApplicationState" NOT NULL DEFAULT 'draft',
    "connectorId" TEXT,
    "connectorType" "ConnectorType",
    "currentOwner" "ApplicationOwner" NOT NULL DEFAULT 'student',
    "externalRef" TEXT,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "acknowledgedRequirements" JSONB NOT NULL DEFAULT '[]',
    "operatorSubmittedById" TEXT,
    "operatorSubmittedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_tasks" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "owner" "ApplicationOwner" NOT NULL,
    "type" "ApplicationTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "ApplicationTaskStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "application_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_snapshots" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "submissionNo" INTEGER NOT NULL,
    "profileVersion" TEXT NOT NULL,
    "documentVersionIds" TEXT[],
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_configs" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "endpointUrl" TEXT,
    "credentialRef" TEXT,
    "signingSecretRef" TEXT,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 900,
    "featureFlag" TEXT NOT NULL DEFAULT 'connector.direct_application',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_attempts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "connectorId" TEXT,
    "snapshotId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "state" "SubmissionAttemptState" NOT NULL DEFAULT 'in_flight',
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "responseBody" JSONB NOT NULL DEFAULT '{}',
    "failureCode" TEXT,
    "failureReason" TEXT,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "submission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_events" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "connectorId" TEXT,
    "providerEventId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "kind" "InboundStatusKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "skippedReason" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "application_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applications_studentId_state_idx" ON "applications"("studentId", "state");

-- CreateIndex
CREATE INDEX "applications_institutionId_state_idx" ON "applications"("institutionId", "state");

-- CreateIndex
CREATE INDEX "applications_externalRef_idx" ON "applications"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "applications_studentId_intakeId_key" ON "applications"("studentId", "intakeId");

-- CreateIndex
CREATE INDEX "application_tasks_applicationId_status_idx" ON "application_tasks"("applicationId", "status");

-- CreateIndex
CREATE INDEX "application_tasks_owner_status_dueAt_idx" ON "application_tasks"("owner", "status", "dueAt");

-- CreateIndex
CREATE INDEX "application_snapshots_payloadHash_idx" ON "application_snapshots"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "application_snapshots_applicationId_submissionNo_key" ON "application_snapshots"("applicationId", "submissionNo");

-- CreateIndex
CREATE INDEX "connector_configs_enabled_idx" ON "connector_configs"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "connector_configs_institutionId_type_key" ON "connector_configs"("institutionId", "type");

-- CreateIndex
CREATE INDEX "submission_attempts_snapshotId_idx" ON "submission_attempts"("snapshotId");

-- CreateIndex
CREATE INDEX "submission_attempts_idempotencyKey_idx" ON "submission_attempts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "submission_attempts_state_nextRetryAt_idx" ON "submission_attempts"("state", "nextRetryAt");

-- CreateIndex
CREATE INDEX "submission_attempts_correlationId_idx" ON "submission_attempts"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_attempts_applicationId_attemptNo_key" ON "submission_attempts"("applicationId", "attemptNo");

-- CreateIndex
CREATE INDEX "application_status_events_applicationId_occurredAt_idx" ON "application_status_events"("applicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "application_status_events_externalRef_idx" ON "application_status_events"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "application_status_events_connectorId_providerEventId_key" ON "application_status_events"("connectorId", "providerEventId");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "intakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connector_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_tasks" ADD CONSTRAINT "application_tasks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_configs" ADD CONSTRAINT "connector_configs_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_attempts" ADD CONSTRAINT "submission_attempts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_events" ADD CONSTRAINT "application_status_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_events" ADD CONSTRAINT "application_status_events_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connector_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only snapshots (Phase 4 §2, FR-011)
-- ---------------------------------------------------------------------------
--
-- Prisma's schema cannot express "no update, no delete", so the guarantee is
-- installed here, in the same two layers the audit table uses: a trigger that
-- holds even for the table owner, and revoked grants so an accidental ORM call
-- fails at permission-check time with a legible error rather than reaching it.
--
-- Note what this table has no foreign key to, and why. A referential
-- `ON DELETE CASCADE` runs a real DELETE against the child and *does* fire its
-- row triggers — verified against this schema rather than assumed. An
-- `applicationId` foreign key would therefore have turned the guarantee below
-- into "no application can ever be deleted", a data-erasure request included,
-- and any `TRUNCATE ... CASCADE` upstream would have failed with it.
--
-- So removing a snapshot stays a deliberate, privileged act rather than a side
-- effect of removing something else. `message_flags` avoids the same trap for
-- the same reason, one phase earlier.

CREATE OR REPLACE FUNCTION application_snapshots_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'application_snapshots is append-only: % is not permitted (attempted on row %)',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS application_snapshots_no_update ON application_snapshots;
CREATE TRIGGER application_snapshots_no_update
  BEFORE UPDATE ON application_snapshots
  FOR EACH ROW EXECUTE FUNCTION application_snapshots_append_only();

DROP TRIGGER IF EXISTS application_snapshots_no_delete ON application_snapshots;
CREATE TRIGGER application_snapshots_no_delete
  BEFORE DELETE ON application_snapshots
  FOR EACH ROW EXECUTE FUNCTION application_snapshots_append_only();

-- TRUNCATE bypasses row triggers entirely, so it needs its own statement trigger.
DROP TRIGGER IF EXISTS application_snapshots_no_truncate ON application_snapshots;
CREATE TRIGGER application_snapshots_no_truncate
  BEFORE TRUNCATE ON application_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION application_snapshots_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'modex_app') THEN
    REVOKE UPDATE, DELETE ON application_snapshots FROM modex_app;
    GRANT INSERT, SELECT ON application_snapshots TO modex_app;
  END IF;
END
$$;
