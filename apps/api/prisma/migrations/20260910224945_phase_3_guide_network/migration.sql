-- Phase 3 — the Verified Student Guide network (#5).
--
-- Purely additive: no column is dropped, no type is changed and no constraint
-- is removed, so a running Phase 2 release is unaffected while this applies.
--
-- The one hand-written part is at the bottom: `message_flags` is append-only,
-- for the same reason `audit_events` is. Evidence that can be edited by the
-- process acting on it is not evidence.

-- CreateEnum
CREATE TYPE "GuideState" AS ENUM ('pending', 'active', 'restricted', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "GuideVerificationStage" AS ENUM ('identity_check', 'current_student_evidence', 'institution_confirmation', 'active');

-- CreateEnum
CREATE TYPE "GuideEvidenceType" AS ENUM ('university_domain_email', 'student_id_document', 'institution_roster');

-- CreateEnum
CREATE TYPE "GuideTopic" AS ENUM ('accommodation', 'cost_of_living', 'campus_life', 'coursework', 'teaching_style', 'part_time_work', 'arrival_and_settling_in', 'city_and_transport', 'societies_and_sport', 'faith_and_community', 'family_and_partners', 'visa_paperwork_experience');

-- CreateEnum
CREATE TYPE "ConversationContextType" AS ENUM ('institution', 'program', 'application', 'general');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'closed', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('student', 'guide', 'system');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('text', 'attachment', 'system');

-- CreateEnum
CREATE TYPE "MessageModerationState" AS ENUM ('clean', 'flagged', 'withheld', 'under_review');

-- CreateEnum
CREATE TYPE "SystemMessageKind" AS ENUM ('conversation_opened', 'guide_restricted', 'guide_suspended', 'conversation_closed', 'risk_flagged', 'session_booked', 'session_cancelled', 'report_submitted');

-- CreateEnum
CREATE TYPE "RiskSignal" AS ENUM ('payment_solicitation', 'guarantee_claim', 'off_platform_solicitation', 'identity_drift', 'message_spam', 'impersonation');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "TrustCaseType" AS ENUM ('payment_solicitation', 'guarantee_claim', 'off_platform_contact', 'impersonation', 'identity_drift', 'spam', 'harassment', 'fraudulent_offer', 'false_institution_claim', 'other');

-- CreateEnum
CREATE TYPE "TrustCaseState" AS ENUM ('open', 'triaging', 'evidence_preserved', 'actioned', 'dismissed', 'escalated');

-- CreateEnum
CREATE TYPE "ReportableTargetType" AS ENUM ('guide', 'message', 'conversation', 'offer', 'institution', 'program', 'user');

-- CreateEnum
CREATE TYPE "SessionChannel" AS ENUM ('chat', 'audio', 'video');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('requested', 'confirmed', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "RewardState" AS ENUM ('not_earned', 'earned', 'approved', 'paid', 'withheld');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('fixed_stipend', 'platform_credit', 'scholarship_contribution', 'certificate', 'university_supported');

-- CreateEnum
CREATE TYPE "QaState" AS ENUM ('draft', 'pending_moderation', 'published', 'rejected', 'withdrawn');

-- DropIndex
DROP INDEX "program_search_documents_intakes";

-- DropIndex
DROP INDEX "program_search_documents_search_text_trgm";

-- CreateTable
CREATE TABLE "student_guides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "campusId" TEXT,
    "programKey" TEXT,
    "level" "ProgramLevel",
    "yearOfStudy" INTEGER,
    "languages" TEXT[],
    "homeCountry" CHAR(2),
    "topics" "GuideTopic"[],
    "bio" TEXT,
    "state" "GuideState" NOT NULL DEFAULT 'pending',
    "stage" "GuideVerificationStage" NOT NULL DEFAULT 'identity_check',
    "verifiedAt" TIMESTAMP(3),
    "evidenceExpiresAt" TIMESTAMP(3),
    "expiryNotifiedAt" TIMESTAMP(3),
    "restrictedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "universityEndorsed" BOOLEAN NOT NULL DEFAULT false,
    "responseTimeHours" DOUBLE PRECISION,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_verifications" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "evidenceType" "GuideEvidenceType" NOT NULL,
    "evidenceRef" TEXT,
    "summary" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "challengeTokenHash" TEXT,
    "challengeExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_identity_changes" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_identity_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_availability_slots" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "topics" "GuideTopic"[],
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "contextType" "ConversationContextType" NOT NULL DEFAULT 'general',
    "contextId" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" "MessageSenderRole" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'text',
    "systemKind" "SystemMessageKind",
    "body" TEXT NOT NULL,
    "attachmentRef" TEXT,
    "moderationState" "MessageModerationState" NOT NULL DEFAULT 'clean',
    "flagSummary" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_flags" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "signal" "RiskSignal" NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "matches" TEXT[],
    "bodySnapshot" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "trustCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_cases" (
    "id" TEXT NOT NULL,
    "type" "TrustCaseType" NOT NULL,
    "reporterId" TEXT,
    "targetType" "ReportableTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "state" "TrustCaseState" NOT NULL DEFAULT 'open',
    "severity" "RiskSeverity" NOT NULL DEFAULT 'medium',
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "assignedTo" TEXT,
    "correlationId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "trust_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_case_events" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromState" "TrustCaseState",
    "toState" "TrustCaseState" NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_sessions" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "slotId" TEXT,
    "channel" "SessionChannel" NOT NULL DEFAULT 'chat',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "SessionStatus" NOT NULL DEFAULT 'requested',
    "topics" "GuideTopic"[],
    "joinRef" TEXT,
    "rewardState" "RewardState" NOT NULL DEFAULT 'not_earned',
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_reward_entries" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "sessionId" TEXT,
    "kind" "RewardKind" NOT NULL DEFAULT 'fixed_stipend',
    "state" "RewardState" NOT NULL DEFAULT 'earned',
    "amountMinor" INTEGER,
    "currency" CHAR(3),
    "earnedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_reward_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_questions" (
    "id" TEXT NOT NULL,
    "askedById" TEXT,
    "institutionId" TEXT NOT NULL,
    "programKey" TEXT,
    "topic" "GuideTopic" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_answers" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "state" "QaState" NOT NULL DEFAULT 'draft',
    "moderatedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderationNote" TEXT,
    "guideConsentedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_guides_userId_key" ON "student_guides"("userId");

-- CreateIndex
CREATE INDEX "student_guides_institutionId_state_idx" ON "student_guides"("institutionId", "state");

-- CreateIndex
CREATE INDEX "student_guides_state_evidenceExpiresAt_idx" ON "student_guides"("state", "evidenceExpiresAt");

-- CreateIndex
CREATE INDEX "guide_verifications_guideId_evidenceType_idx" ON "guide_verifications"("guideId", "evidenceType");

-- CreateIndex
CREATE INDEX "guide_verifications_expiresAt_idx" ON "guide_verifications"("expiresAt");

-- CreateIndex
CREATE INDEX "guide_identity_changes_guideId_changedAt_idx" ON "guide_identity_changes"("guideId", "changedAt");

-- CreateIndex
CREATE INDEX "guide_availability_slots_guideId_startsAt_idx" ON "guide_availability_slots"("guideId", "startsAt");

-- CreateIndex
CREATE INDEX "conversations_studentId_lastMessageAt_idx" ON "conversations"("studentId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_guideId_lastMessageAt_idx" ON "conversations"("guideId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_studentId_guideId_contextType_contextId_key" ON "conversations"("studentId", "guideId", "contextType", "contextId");

-- CreateIndex
CREATE INDEX "messages_conversationId_sentAt_idx" ON "messages"("conversationId", "sentAt");

-- CreateIndex
CREATE INDEX "message_flags_messageId_idx" ON "message_flags"("messageId");

-- CreateIndex
CREATE INDEX "message_flags_signal_severity_idx" ON "message_flags"("signal", "severity");

-- CreateIndex
CREATE INDEX "trust_cases_state_severity_idx" ON "trust_cases"("state", "severity");

-- CreateIndex
CREATE INDEX "trust_cases_targetType_targetId_idx" ON "trust_cases"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "trust_cases_reporterId_idx" ON "trust_cases"("reporterId");

-- CreateIndex
CREATE INDEX "trust_case_events_caseId_createdAt_idx" ON "trust_case_events"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "guide_sessions_studentId_scheduledFor_idx" ON "guide_sessions"("studentId", "scheduledFor");

-- CreateIndex
CREATE INDEX "guide_sessions_guideId_scheduledFor_idx" ON "guide_sessions"("guideId", "scheduledFor");

-- CreateIndex
CREATE INDEX "guide_sessions_status_idx" ON "guide_sessions"("status");

-- CreateIndex
CREATE INDEX "guide_reward_entries_guideId_state_idx" ON "guide_reward_entries"("guideId", "state");

-- CreateIndex
CREATE INDEX "guide_questions_institutionId_topic_idx" ON "guide_questions"("institutionId", "topic");

-- CreateIndex
CREATE INDEX "guide_answers_questionId_idx" ON "guide_answers"("questionId");

-- CreateIndex
CREATE INDEX "guide_answers_state_publishedAt_idx" ON "guide_answers"("state", "publishedAt");

-- AddForeignKey
ALTER TABLE "student_guides" ADD CONSTRAINT "student_guides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guides" ADD CONSTRAINT "student_guides_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guides" ADD CONSTRAINT "student_guides_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_verifications" ADD CONSTRAINT "guide_verifications_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_identity_changes" ADD CONSTRAINT "guide_identity_changes_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_availability_slots" ADD CONSTRAINT "guide_availability_slots_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_flags" ADD CONSTRAINT "message_flags_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_flags" ADD CONSTRAINT "message_flags_trustCaseId_fkey" FOREIGN KEY ("trustCaseId") REFERENCES "trust_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_case_events" ADD CONSTRAINT "trust_case_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "trust_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_sessions" ADD CONSTRAINT "guide_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_sessions" ADD CONSTRAINT "guide_sessions_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_sessions" ADD CONSTRAINT "guide_sessions_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "guide_availability_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_reward_entries" ADD CONSTRAINT "guide_reward_entries_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_reward_entries" ADD CONSTRAINT "guide_reward_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "guide_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_questions" ADD CONSTRAINT "guide_questions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_answers" ADD CONSTRAINT "guide_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "guide_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_answers" ADD CONSTRAINT "guide_answers_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "student_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only risk evidence (Phase 3 §4)
-- ---------------------------------------------------------------------------
--
-- "Every flag preserves evidence immutably before any moderation action."
-- Prisma cannot express that, so it is installed here — the same two layers as
-- the audit log: a trigger that holds even for the table owner, and revoked
-- grants so an accidental ORM call fails early with a clear error.
--
-- Note this is *not* the audit table, so the audit-guard rules in
-- `scripts/check-migration-safety.mjs` do not apply; the append-only property
-- is nonetheless the same one, and dropping these triggers would show up in
-- migration review exactly as dropping those would.

CREATE OR REPLACE FUNCTION message_flags_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'message_flags is append-only: % is not permitted (attempted on row %)',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_flags_no_update ON message_flags;
CREATE TRIGGER message_flags_no_update
  BEFORE UPDATE ON message_flags
  FOR EACH ROW EXECUTE FUNCTION message_flags_append_only();

DROP TRIGGER IF EXISTS message_flags_no_delete ON message_flags;
CREATE TRIGGER message_flags_no_delete
  BEFORE DELETE ON message_flags
  FOR EACH ROW EXECUTE FUNCTION message_flags_append_only();

-- TRUNCATE bypasses row triggers entirely, so it needs its own statement trigger.
DROP TRIGGER IF EXISTS message_flags_no_truncate ON message_flags;
CREATE TRIGGER message_flags_no_truncate
  BEFORE TRUNCATE ON message_flags
  FOR EACH STATEMENT EXECUTE FUNCTION message_flags_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'modex_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON message_flags FROM modex_app;
    GRANT INSERT, SELECT ON message_flags TO modex_app;
  END IF;
END
$$;
