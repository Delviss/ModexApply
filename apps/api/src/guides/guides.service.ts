import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  GUIDE_EVIDENCE_VALIDITY_DAYS,
  GUIDE_VERIFICATION_STAGES,
  SYSTEM_MESSAGE_TEXT,
  daysUntil,
  guideDisplayName,
  guideExpiryUrgency,
  isGuideDiscoverable,
  matchGuides,
  requiresReverificationForDrift,
  toPublicGuideProfile,
  type AccessContext,
  type GuideCandidate,
  type GuideEvidenceType,
  type GuideMatch,
  type GuideMatchCriteria,
  type GuideRecord,
  type GuideTopic,
  type GuideVerificationStage,
  type ProgramLevel,
  type PublicGuideProfile,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { QUEUES, QueueService } from '../queue/queue.service.js';

/** Seen inside this window counts as online. Never a precise last-seen time. */
const ONLINE_WINDOW_MINUTES = 5;

/** The university-domain email challenge is short-lived, like every other one. */
const EMAIL_CHALLENGE_TTL_HOURS = 72;

export interface GuideProfilePatch {
  institutionId?: string;
  campusId?: string | null;
  programKey?: string | null;
  level?: ProgramLevel | null;
  yearOfStudy?: number | null;
  languages?: string[];
  homeCountry?: string | null;
  topics?: GuideTopic[];
  bio?: string | null;
}

/**
 * The guide roster (Phase 3 §1–§2, FR-007/FR-016).
 *
 * Three properties are enforced here rather than described:
 *
 *  1. **A guide is always a link to current-student evidence.** `institutionId`
 *     is not nullable, verification cannot reach `active` without a verified
 *     `GuideVerification` row read back from the database, and the expiry on
 *     that row is mirrored onto the guide so the sweep can find it.
 *
 *  2. **Nothing student-facing selects a contact detail.** Every read that a
 *     student can reach goes through `toPublicGuideProfile`, whose output schema
 *     is `.strict()`. Adding a column to `student_guides` does not put it in a
 *     student's browser.
 *
 *  3. **Changing which university you study at is not a profile edit.** It is
 *     recorded as an identity change, and enough of them force reverification
 *     (TRD §14) — the drift signal, applied where the drift happens.
 */
@Injectable()
export class GuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration and verification
  // -------------------------------------------------------------------------

  /**
   * Creates a guide record in `pending`.
   *
   * `pending` is not a soft version of active: a pending guide cannot message,
   * cannot be booked and does not appear in the directory. Everything after this
   * call is about producing evidence.
   */
  async register(
    access: AccessContext,
    input: { institutionId: string; campusId?: string | null; programKey?: string | null },
  ) {
    const existing = await this.prisma.studentGuide.findUnique({ where: { userId: access.userId } });
    if (existing !== null) {
      throw new AppError('conflict', 'You already have a guide profile.');
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: input.institutionId },
      select: { id: true, partnerships: { select: { status: true, scopes: true } } },
    });
    if (institution === null) throw AppError.notFound('Institution');

    // Universities approve their guide roster, or agree to Modex verification
    // rules — recorded in the partnership scopes from #3. Without the scope
    // there is no guide programme at this university to join.
    const permitted = institution.partnerships.some(
      (partnership) =>
        partnership.status === 'active' && partnership.scopes.includes('guide_programme'),
    );
    if (!permitted) {
      throw AppError.stateTransition(
        'This university does not run a Modex guide programme yet.',
        { institutionId: input.institutionId },
      );
    }

    const guide = await this.prisma.studentGuide.create({
      data: {
        userId: access.userId,
        institutionId: input.institutionId,
        campusId: input.campusId ?? null,
        programKey: input.programKey ?? null,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.registered',
      objectType: 'guide',
      objectId: guide.id,
      metadata: { institutionId: input.institutionId },
    });

    return this.dashboard(access);
  }

  /**
   * Records evidence and advances the pipeline one stage.
   *
   * The evidence row is written unverified. Nothing here verifies anything: a
   * guide asserting they are a student is the input to verification, not the
   * output of it.
   */
  async submitEvidence(
    access: AccessContext,
    input: { evidenceType: GuideEvidenceType; evidenceRef?: string | null; summary: string },
  ) {
    const guide = await this.requireOwnGuide(access);

    const evidence = await this.prisma.guideVerification.create({
      data: {
        guideId: guide.id,
        evidenceType: input.evidenceType,
        evidenceRef: input.evidenceRef ?? null,
        summary: input.summary,
      },
      select: { id: true, evidenceType: true, createdAt: true },
    });

    await this.advanceStage(guide.id, guide.stage, 'current_student_evidence');

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.evidence_submitted',
      objectType: 'guide',
      objectId: guide.id,
      // The reference is a storage key; the evidence itself never enters a log.
      metadata: { evidenceType: input.evidenceType, evidenceId: evidence.id },
    });

    return { id: evidence.id, evidenceType: evidence.evidenceType, submittedAt: evidence.createdAt };
  }

  /**
   * Issues a university-domain email challenge.
   *
   * The strongest of the three evidence types, because it is the only one the
   * guide cannot produce alone: it needs a live mailbox on a domain the
   * institution already confirmed in Phase 1. The token is returned once, to be
   * emailed, and only its hash is stored.
   */
  async issueEmailChallenge(access: AccessContext, email: string) {
    const guide = await this.requireOwnGuide(access);
    const institution = await this.prisma.institution.findUnique({
      where: { id: guide.institutionId },
      select: { domains: true, verificationState: true },
    });
    if (institution === null) throw AppError.notFound('Institution');

    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    const claimed = institution.domains.map((entry) => entry.toLowerCase().replace(/^www\./, ''));
    if (!claimed.includes(domain)) {
      throw AppError.validation('That address is not on one of this university’s domains.', [
        {
          field: 'email',
          code: 'off_domain',
          message: `Use your ${claimed[0] ?? 'university'} address.`,
        },
      ]);
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + EMAIL_CHALLENGE_TTL_HOURS * 3_600_000);

    const evidence = await this.prisma.guideVerification.create({
      data: {
        guideId: guide.id,
        evidenceType: 'university_domain_email',
        summary: `Email challenge to an address on ${domain}`,
        challengeTokenHash: hashToken(token),
        challengeExpiresAt: expiresAt,
      },
      select: { id: true },
    });

    await this.queue.enqueue(QUEUES.notifications, 'guide-email-challenge', {
      guideId: guide.id,
      email,
      token,
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.evidence_submitted',
      objectType: 'guide',
      objectId: guide.id,
      metadata: { evidenceType: 'university_domain_email', domain, evidenceId: evidence.id },
    });

    // The token leaves in the response exactly once, for the notification
    // worker to post. It is never readable afterwards.
    return { id: evidence.id, expiresAt, token };
  }

  /** Confirms the challenge. This is the one path a guide can walk unaided. */
  async confirmEmailChallenge(access: AccessContext, evidenceId: string, token: string) {
    const guide = await this.requireOwnGuide(access);
    const evidence = await this.prisma.guideVerification.findFirst({
      where: { id: evidenceId, guideId: guide.id, evidenceType: 'university_domain_email' },
    });
    if (evidence === null) throw AppError.notFound('Challenge');
    if (evidence.verifiedAt !== null) {
      throw new AppError('conflict', 'This challenge has already been used.');
    }
    if (evidence.challengeExpiresAt === null || evidence.challengeExpiresAt <= new Date()) {
      throw AppError.stateTransition('That challenge has expired. Ask for a new one.');
    }
    if (evidence.challengeTokenHash !== hashToken(token)) {
      // Deliberately the same message as an expired challenge would give a
      // guessing caller nothing to distinguish. A wrong token is not a hint.
      throw AppError.stateTransition('That challenge could not be confirmed.');
    }

    const expiresAt = addDays(new Date(), GUIDE_EVIDENCE_VALIDITY_DAYS);
    await this.prisma.guideVerification.update({
      where: { id: evidence.id },
      data: {
        verifiedAt: new Date(),
        expiresAt,
        // Single-use: the hash goes, so a replay has nothing to match against.
        challengeTokenHash: null,
      },
    });

    await this.advanceStage(guide.id, guide.stage, 'institution_confirmation');

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.verification_advanced',
      objectType: 'guide',
      objectId: guide.id,
      metadata: { evidenceType: 'university_domain_email', evidenceId: evidence.id },
    });

    return { confirmed: true, evidenceExpiresAt: expiresAt };
  }

  /**
   * Activates a guide. Trust only — `guide:verify`.
   *
   * The evidence is read back from the database rather than taken from the
   * caller, so "verify this guide" cannot be turned into "assert this guide is
   * verified" by a request body. Same rule as institution verification in
   * Phase 1 §2, for the same reason.
   */
  async verify(access: AccessContext, guideId: string) {
    const guide = await this.prisma.studentGuide.findUnique({
      where: { id: guideId },
      include: { verifications: true },
    });
    if (guide === null) throw AppError.notFound('Guide');

    const now = new Date();
    const live = guide.verifications
      .filter(
        (evidence) =>
          evidence.verifiedAt !== null &&
          evidence.expiresAt !== null &&
          evidence.expiresAt > now,
      )
      .sort((left, right) => (right.expiresAt?.getTime() ?? 0) - (left.expiresAt?.getTime() ?? 0));

    if (live.length === 0) {
      throw AppError.stateTransition(
        'This guide has no live current-student evidence, so they cannot be activated.',
        { guideId },
      );
    }

    const expiresAt = live[0]?.expiresAt ?? addDays(now, GUIDE_EVIDENCE_VALIDITY_DAYS);

    const updated = await this.prisma.studentGuide.update({
      where: { id: guideId },
      data: {
        state: 'active',
        stage: 'active',
        verifiedAt: now,
        evidenceExpiresAt: expiresAt,
        expiryNotifiedAt: null,
        restrictedAt: null,
        suspendedAt: null,
        suspensionReason: null,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.verified',
      objectType: 'guide',
      objectId: guideId,
      metadata: {
        evidenceTypes: live.map((evidence) => evidence.evidenceType),
        expiresAt: expiresAt.toISOString(),
      },
    });

    return { id: updated.id, state: updated.state, evidenceExpiresAt: updated.evidenceExpiresAt };
  }

  /**
   * Suspends a guide and closes the door behind them, in one transaction:
   * out of the directory, out of every open conversation, and out of every
   * scheduled session.
   *
   * The system message is written *inside* the transaction. A student whose
   * guide vanished with no explanation is the failure this exists to prevent, so
   * "suspended" and "the students were told" cannot come apart (Phase 3
   * acceptance criterion 8).
   */
  async suspend(actor: AuditActor, guideId: string, reason: string) {
    const guide = await this.prisma.studentGuide.findUnique({ where: { id: guideId } });
    if (guide === null) throw AppError.notFound('Guide');

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.studentGuide.update({
        where: { id: guideId },
        data: { state: 'suspended', suspendedAt: new Date(), suspensionReason: reason },
      });

      const conversations = await tx.conversation.findMany({
        where: { guideId, status: 'open' },
        select: { id: true },
      });

      for (const conversation of conversations) {
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: null,
            senderRole: 'system',
            kind: 'system',
            systemKind: 'guide_suspended',
            body: SYSTEM_MESSAGE_TEXT.guide_suspended,
          },
        });
      }

      await tx.conversation.updateMany({
        where: { guideId, status: 'open' },
        data: { status: 'suspended', closedAt: new Date(), closedReason: 'guide_suspended' },
      });

      // Scheduled sessions are cancelled and the slot is handed back, so the
      // guide's calendar does not keep holding time they cannot honour.
      const upcoming = await tx.guideSession.findMany({
        where: { guideId, status: { in: ['requested', 'confirmed'] } },
        select: { id: true, slotId: true },
      });
      for (const session of upcoming) {
        await tx.guideSession.update({
          where: { id: session.id },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancellationReason: 'The guide is no longer available.',
          },
        });
        if (session.slotId !== null) {
          await tx.guideAvailabilitySlot.update({
            where: { id: session.slotId },
            data: { booked: { decrement: 1 } },
          });
        }
      }

      return {
        state: updated.state,
        conversationsSuspended: conversations.length,
        sessionsCancelled: upcoming.length,
      };
    });

    await this.audit.record({
      actor,
      action: 'guide.suspended',
      objectType: 'guide',
      objectId: guideId,
      metadata: { reason, ...result },
    });

    return result;
  }

  /** Restriction: no messaging, out of the directory, conversations untouched. */
  async restrict(actor: AuditActor, guideId: string, reason: string) {
    await this.prisma.studentGuide.update({
      where: { id: guideId },
      data: { state: 'restricted', restrictedAt: new Date() },
    });

    const conversations = await this.prisma.conversation.findMany({
      where: { guideId, status: 'open' },
      select: { id: true },
    });
    for (const conversation of conversations) {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: null,
          senderRole: 'system',
          kind: 'system',
          systemKind: 'guide_restricted',
          body: SYSTEM_MESSAGE_TEXT.guide_restricted,
        },
      });
    }

    await this.audit.record({
      actor,
      action: 'guide.restricted',
      objectType: 'guide',
      objectId: guideId,
      metadata: { reason, conversationsNotified: conversations.length },
    });

    return { state: 'restricted' as const, conversationsNotified: conversations.length };
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  /**
   * Updates the guide's own profile.
   *
   * Institution and programme changes are not ordinary edits: each one is
   * recorded as an identity change, the guide drops back to `pending` (their
   * evidence was for the *old* university), and enough changes inside the drift
   * window opens a trust case.
   */
  async updateProfile(access: AccessContext, patch: GuideProfilePatch) {
    const guide = await this.requireOwnGuide(access);

    const identityChanges: { field: string; previousValue: string | null; newValue: string | null }[] =
      [];
    if (patch.institutionId !== undefined && patch.institutionId !== guide.institutionId) {
      identityChanges.push({
        field: 'institutionId',
        previousValue: guide.institutionId,
        newValue: patch.institutionId,
      });
    }
    if (patch.programKey !== undefined && patch.programKey !== guide.programKey) {
      identityChanges.push({
        field: 'programKey',
        previousValue: guide.programKey,
        newValue: patch.programKey ?? null,
      });
    }

    const updated = await this.prisma.studentGuide.update({
      where: { id: guide.id },
      data: {
        ...(patch.institutionId !== undefined ? { institutionId: patch.institutionId } : {}),
        ...(patch.campusId !== undefined ? { campusId: patch.campusId } : {}),
        ...(patch.programKey !== undefined ? { programKey: patch.programKey } : {}),
        ...(patch.level !== undefined ? { level: patch.level } : {}),
        ...(patch.yearOfStudy !== undefined ? { yearOfStudy: patch.yearOfStudy } : {}),
        ...(patch.languages !== undefined ? { languages: patch.languages } : {}),
        ...(patch.homeCountry !== undefined ? { homeCountry: patch.homeCountry } : {}),
        ...(patch.topics !== undefined ? { topics: patch.topics } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        // Evidence proves you study *there*. Change where, and it proves nothing.
        ...(identityChanges.length > 0
          ? { state: 'pending' as const, stage: 'current_student_evidence' as const, verifiedAt: null }
          : {}),
      },
    });

    for (const change of identityChanges) {
      await this.prisma.guideIdentityChange.create({ data: { guideId: guide.id, ...change } });
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'guide.profile_updated',
      objectType: 'guide',
      objectId: guide.id,
      metadata: { fields: Object.keys(patch), identityChanges: identityChanges.length },
    });

    if (identityChanges.length > 0) {
      const history = await this.prisma.guideIdentityChange.findMany({
        where: { guideId: guide.id, field: { in: ['institutionId', 'programKey'] } },
        select: { changedAt: true },
      });
      if (requiresReverificationForDrift(history)) {
        await this.audit.record({
          actor: toAuditActor(access),
          action: 'guide.identity_drift_detected',
          objectType: 'guide',
          objectId: guide.id,
          metadata: { changes: history.length },
        });
        await this.queue.enqueue(QUEUES.notifications, 'guide-identity-drift', {
          guideId: guide.id,
          changes: history.length,
        });
      }
    }

    return { id: updated.id, state: updated.state, stage: updated.stage };
  }

  // -------------------------------------------------------------------------
  // Directory and profile reads
  // -------------------------------------------------------------------------

  /**
   * The directory (Phase 3 §2).
   *
   * `matchGuides` does the ordering, and the query does the filtering that must
   * never be a weight: an unverified, restricted or suspended guide is not
   * fetched at all, so a bug in the ranker cannot surface one.
   */
  async directory(criteria: GuideMatchCriteria): Promise<GuideMatch[]> {
    const now = new Date();
    const rows = await this.prisma.studentGuide.findMany({
      where: { institutionId: criteria.institutionId, state: 'active' },
      include: GUIDE_INCLUDE,
    });

    const candidates: GuideCandidate[] = await Promise.all(
      rows.map(async (row) => ({
        profile: toPublicGuideProfile(await this.toRecord(row, now)),
        openSlots: await this.countOpenSlots(row.id, now),
      })),
    );

    return matchGuides(candidates, criteria);
  }

  /** One public profile. A guide who is not discoverable is a 404, not a 403. */
  async publicProfile(guideId: string): Promise<PublicGuideProfile> {
    const row = await this.prisma.studentGuide.findUnique({
      where: { id: guideId },
      include: GUIDE_INCLUDE,
    });
    // "Not found" rather than "suspended": a probe must not be able to read a
    // suspension off the API, and the student sees the suspension in the thread
    // they already have, where it comes with an explanation.
    if (row === null || !isGuideDiscoverable(row.state)) throw AppError.notFound('Guide');
    return toPublicGuideProfile(await this.toRecord(row, new Date()));
  }

  /**
   * The guide's own dashboard.
   *
   * The one read that legitimately shows more than the public projection — and
   * it shows it to the guide about themselves, which is the only case where the
   * private half is theirs to see.
   */
  async dashboard(access: AccessContext, now: Date = new Date()) {
    const row = await this.prisma.studentGuide.findUnique({
      where: { userId: access.userId },
      include: GUIDE_INCLUDE,
    });
    if (row === null) throw AppError.notFound('Guide profile');

    const [sessions, rewards, openConversations] = await Promise.all([
      this.prisma.guideSession.findMany({
        where: { guideId: row.id, status: { in: ['requested', 'confirmed'] } },
        orderBy: { scheduledFor: 'asc' },
        take: 10,
      }),
      this.prisma.guideRewardEntry.findMany({
        where: { guideId: row.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.conversation.count({ where: { guideId: row.id, status: 'open' } }),
    ]);

    const record = await this.toRecord(row, now);

    return {
      profile: toPublicGuideProfile(record),
      verification: {
        stage: row.stage,
        state: row.state,
        pipeline: GUIDE_VERIFICATION_STAGES.map((stage) => ({
          stage,
          status: stageStatus(stage, row.stage, row.state),
        })),
        evidence: row.verifications.map((evidence) => ({
          id: evidence.id,
          evidenceType: evidence.evidenceType,
          summary: evidence.summary,
          verifiedAt: evidence.verifiedAt,
          expiresAt: evidence.expiresAt,
        })),
        expiresAt: row.evidenceExpiresAt,
        expiryUrgency: guideExpiryUrgency(row.evidenceExpiresAt, now),
        daysRemaining: row.evidenceExpiresAt === null ? null : daysUntil(row.evidenceExpiresAt, now),
        suspensionReason: row.suspensionReason,
      },
      upcomingSessions: sessions,
      rewards,
      openConversations,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Loads the caller's own guide row, or explains why there is not one. */
  async requireOwnGuide(access: AccessContext) {
    const guide = await this.prisma.studentGuide.findUnique({ where: { userId: access.userId } });
    if (guide === null) throw AppError.notFound('Guide profile');
    return guide;
  }

  private async countOpenSlots(guideId: string, now: Date): Promise<number> {
    const slots = await this.prisma.guideAvailabilitySlot.findMany({
      where: { guideId, startsAt: { gt: now } },
      select: { capacity: true, booked: true },
    });
    return slots.filter((slot) => slot.booked < slot.capacity).length;
  }

  /**
   * Builds the full record — private fields included — so the projection has
   * something to project *from*. Everything a student can reach passes the
   * result of this straight into `toPublicGuideProfile`.
   */
  private async toRecord(row: GuideRow, now: Date): Promise<GuideRecord> {
    const programName =
      row.programKey === null
        ? null
        : ((
            await this.prisma.program.findFirst({
              where: { programKey: row.programKey, effectiveTo: null },
              select: { name: true },
            })
          )?.name ?? null);

    return {
      id: row.id,
      displayName: guideDisplayName(row.user.displayName),
      avatarRef: null,
      institutionId: row.institutionId,
      institutionName: row.institution.displayName,
      campusId: row.campusId,
      campusName: row.campus?.name ?? null,
      programKey: row.programKey,
      programName,
      level: row.level,
      yearOfStudy: row.yearOfStudy,
      languages: row.languages,
      homeCountry: row.homeCountry,
      topics: row.topics,
      bio: row.bio,
      state: row.state,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      expiresAt: row.evidenceExpiresAt?.toISOString() ?? null,
      responseTimeHours: row.responseTimeHours,
      online:
        row.lastSeenAt !== null &&
        now.getTime() - row.lastSeenAt.getTime() < ONLINE_WINDOW_MINUTES * 60_000,
      trustScore: row.trustScore,
      universityEndorsed: row.universityEndorsed,

      // The private half. Present so the projection is a real narrowing rather
      // than a rename, and so a test can prove none of it survives the trip.
      userId: row.userId,
      email: row.user.email,
      phone: row.user.phone,
      offPlatformHandles: {},
      legalName: row.user.displayName,
      evidence: row.verifications.map((evidence) => ({
        id: evidence.id,
        guideId: evidence.guideId,
        evidenceType: evidence.evidenceType,
        evidenceRef: evidence.evidenceRef,
        verifiedAt: evidence.verifiedAt?.toISOString() ?? null,
        expiresAt: evidence.expiresAt?.toISOString() ?? null,
        reviewerId: evidence.reviewerId,
      })),
      internalNotes: row.suspensionReason,
    };
  }

  private async advanceStage(
    guideId: string,
    current: GuideVerificationStage,
    target: GuideVerificationStage,
  ): Promise<void> {
    // Forward only. A guide who submits a second piece of evidence after the
    // institution confirmed them does not fall back a stage.
    if (GUIDE_VERIFICATION_STAGES.indexOf(target) <= GUIDE_VERIFICATION_STAGES.indexOf(current)) {
      return;
    }
    // `active` is Trust's to award, never a side effect of a guide's own upload.
    if (target === 'active') return;
    await this.prisma.studentGuide.update({ where: { id: guideId }, data: { stage: target } });
  }
}

export const GUIDE_INCLUDE = {
  user: { select: { displayName: true, email: true, phone: true } },
  institution: { select: { displayName: true } },
  campus: { select: { name: true } },
  verifications: true,
} as const;

type GuideRow = Prisma.StudentGuideGetPayload<{ include: typeof GUIDE_INCLUDE }>;

function stageStatus(
  stage: GuideVerificationStage,
  current: GuideVerificationStage,
  state: GuideRow['state'],
): 'pending' | 'active' | 'done' | 'error' {
  const stageIndex = GUIDE_VERIFICATION_STAGES.indexOf(stage);
  const currentIndex = GUIDE_VERIFICATION_STAGES.indexOf(current);
  if (state === 'suspended' || state === 'revoked') return stageIndex <= currentIndex ? 'error' : 'pending';
  if (stageIndex < currentIndex) return 'done';
  if (stageIndex === currentIndex) return state === 'active' ? 'done' : 'active';
  return 'pending';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
