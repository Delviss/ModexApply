import { Injectable } from '@nestjs/common';
import {
  BOOKING_HORIZON_DAYS,
  SESSION_DURATION_MINUTES,
  SYSTEM_MESSAGE_TEXT,
  canTransitionSession,
  conflictsWithExisting,
  isSlotBookable,
  rewardStateForSession,
  slotBlockReason,
  type AccessContext,
  type GuideTopic,
  type RewardState,
  type SessionChannel,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { toAuditActor } from '../auth/audit-actor.js';
import { GuidesService } from '../guides/guides.service.js';
import { TrustService } from '../trust/trust.service.js';

/** A fixed stipend per completed session, in minor units. Finance (#8) owns the
 *  rate; it lives here as the default the ledger is written with. */
export const SESSION_STIPEND_MINOR = 1_000;
export const SESSION_STIPEND_CURRENCY = 'GBP';

/**
 * Availability, booking and the reward ledger (Phase 3 §2, §3 and §5).
 *
 * The two rules this file exists to hold:
 *
 *  1. **The platform prevents overbooking**, inside the transaction, with the
 *     slot row locked. A calendar that greys out a full slot is a courtesy; the
 *     `booked < capacity` check under `SELECT ... FOR UPDATE` is the guarantee.
 *
 *  2. **A reward never reads an application.** `rewardStateForSession` takes
 *     session delivery and throws if handed an admission outcome, and this
 *     service has no access to an application to hand it one.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guides: GuidesService,
    private readonly trust: TrustService,
  ) {}

  // -------------------------------------------------------------------------
  // Availability — the guide's own calendar
  // -------------------------------------------------------------------------

  async addSlot(
    access: AccessContext,
    input: { startsAt: string; endsAt: string; topics?: GuideTopic[]; capacity?: number },
  ) {
    const guide = await this.guides.requireOwnGuide(access);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw AppError.validation('A slot has to end after it starts.', [
        { field: 'endsAt', code: 'before_start', message: 'Pick a later finish time.' },
      ]);
    }
    if (startsAt <= new Date()) {
      throw AppError.validation('That slot is in the past.', [
        { field: 'startsAt', code: 'past', message: 'Pick a time in the future.' },
      ]);
    }

    const existing = await this.prisma.guideAvailabilitySlot.findMany({
      where: { guideId: guide.id, startsAt: { gte: new Date() } },
      select: { startsAt: true, endsAt: true },
    });
    // Told about the clash while they are creating it, rather than by a booking
    // failing later for a reason nobody can see.
    if (
      conflictsWithExisting(
        { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        existing.map((slot) => ({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
        })),
      )
    ) {
      throw new AppError('conflict', 'That overlaps a slot you have already offered.');
    }

    return this.prisma.guideAvailabilitySlot.create({
      data: {
        guideId: guide.id,
        startsAt,
        endsAt,
        topics: input.topics ?? [],
        capacity: input.capacity ?? 1,
      },
    });
  }

  async removeSlot(access: AccessContext, slotId: string) {
    const guide = await this.guides.requireOwnGuide(access);
    const slot = await this.prisma.guideAvailabilitySlot.findFirst({
      where: { id: slotId, guideId: guide.id },
    });
    if (slot === null) throw AppError.notFound('Slot');
    if (slot.booked > 0) {
      // A booked slot is somebody's plan. Cancelling the session is a separate,
      // deliberate act that tells the student; deleting the slot would not.
      throw AppError.stateTransition('Somebody has booked this slot. Cancel the session instead.');
    }
    await this.prisma.guideAvailabilitySlot.delete({ where: { id: slotId } });
    return { deleted: true };
  }

  /**
   * The bookable slots a student sees.
   *
   * Past and fully-booked slots come back too, marked with the reason: the
   * calendar greys them out, which makes the no-overbooking rule visible rather
   * than an error after the fact (Phase 3 design spec).
   */
  async availability(guideId: string, now: Date = new Date()) {
    const horizon = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000);
    const slots = await this.prisma.guideAvailabilitySlot.findMany({
      where: { guideId, startsAt: { lte: horizon } },
      orderBy: { startsAt: 'asc' },
    });

    return slots.map((slot) => {
      const shape = {
        capacity: slot.capacity,
        booked: slot.booked,
        startsAt: slot.startsAt.toISOString(),
      };
      return {
        id: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        topics: slot.topics,
        capacity: slot.capacity,
        booked: slot.booked,
        bookable: isSlotBookable(shape, now),
        blockedReason: slotBlockReason(shape, now),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Booking
  // -------------------------------------------------------------------------

  /**
   * Books a slot.
   *
   * The capacity check and the increment are one statement under a row lock, so
   * two students clicking the same slot at the same moment cannot both win. The
   * pre-check exists to give a good error, not to be the guarantee.
   */
  async book(
    access: AccessContext,
    input: { slotId: string; channel?: SessionChannel; topics?: GuideTopic[]; durationMinutes?: number },
  ) {
    const duration = input.durationMinutes ?? 30;
    if (!SESSION_DURATION_MINUTES.includes(duration as (typeof SESSION_DURATION_MINUTES)[number])) {
      throw AppError.validation('That is not a session length we offer.', [
        {
          field: 'durationMinutes',
          code: 'unsupported',
          message: `Pick one of ${SESSION_DURATION_MINUTES.join(', ')} minutes.`,
        },
      ]);
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: string; guideId: string; startsAt: Date; capacity: number; booked: number }[]
      >`SELECT id, "guideId", "startsAt", capacity, booked
          FROM guide_availability_slots
         WHERE id = ${input.slotId}
         FOR UPDATE`;

      if (locked === undefined) throw AppError.notFound('Slot');
      if (!isSlotBookable(
        { capacity: locked.capacity, booked: locked.booked, startsAt: locked.startsAt.toISOString() },
      )) {
        throw new AppError(
          'conflict',
          slotBlockReason({
            capacity: locked.capacity,
            booked: locked.booked,
            startsAt: locked.startsAt.toISOString(),
          }) ?? 'That slot is no longer available.',
        );
      }

      const guide = await tx.studentGuide.findUnique({
        where: { id: locked.guideId },
        select: { id: true, state: true },
      });
      // A guide whose evidence lapsed between offering the slot and the student
      // clicking it is not bookable, whatever the calendar still shows.
      if (guide === null || guide.state !== 'active') {
        throw AppError.stateTransition('This guide is not taking sessions at the moment.');
      }

      await tx.guideAvailabilitySlot.update({
        where: { id: locked.id },
        data: { booked: { increment: 1 } },
      });

      return tx.guideSession.create({
        data: {
          studentId: access.userId,
          guideId: locked.guideId,
          slotId: locked.id,
          channel: input.channel ?? 'chat',
          scheduledFor: locked.startsAt,
          durationMinutes: duration,
          topics: input.topics ?? [],
          status: 'confirmed',
          // A Modex-managed room, never a personal number.
          joinRef: `modex-room:${locked.id}`,
        },
      });
    });

    // The conversation, if there is one, says a session was booked — and says
    // in the same breath that payment never goes to a guide.
    const conversation = await this.prisma.conversation.findFirst({
      where: { studentId: access.userId, guideId: session.guideId, status: 'open' },
      select: { id: true },
    });
    if (conversation !== null) {
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: null,
          senderRole: 'system',
          kind: 'system',
          systemKind: 'session_booked',
          body: SYSTEM_MESSAGE_TEXT.session_booked,
        },
      });
    }

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'session.booked',
      objectType: 'session',
      objectId: session.id,
      metadata: { guideId: session.guideId, slotId: session.slotId, channel: session.channel },
    });

    return session;
  }

  async cancel(access: AccessContext, sessionId: string, reason: string) {
    const session = await this.requireParticipant(access, sessionId);
    if (!canTransitionSession(session.status, 'cancelled')) {
      throw AppError.stateTransition(`A ${session.status} session cannot be cancelled.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.guideSession.update({
        where: { id: sessionId },
        data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason },
      });
      if (session.slotId !== null) {
        await tx.guideAvailabilitySlot.update({
          where: { id: session.slotId },
          data: { booked: { decrement: 1 } },
        });
      }
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'session.cancelled',
      objectType: 'session',
      objectId: sessionId,
      metadata: { reason, cancelledBy: access.userId },
    });

    return { status: 'cancelled' as const };
  }

  /**
   * Completes a session and writes the reward.
   *
   * Note what is loaded to make the decision: the session's own status, whether
   * the student disputed it, and whether the guide is under review. There is no
   * application in scope, and `rewardStateForSession` would throw if one were
   * passed.
   */
  async complete(access: AccessContext, sessionId: string, outcome: 'completed' | 'no_show') {
    const session = await this.requireParticipant(access, sessionId);
    if (!canTransitionSession(session.status, outcome)) {
      throw AppError.stateTransition(`A ${session.status} session cannot become ${outcome}.`);
    }

    const trustCaseOpen = await this.trust.hasOpenCase(session.guideId);
    const completedAt = new Date();
    const rewardState: RewardState = rewardStateForSession({
      status: outcome,
      completedAt: completedAt.toISOString(),
      trustCaseOpen,
      disputed: session.disputedAt !== null,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.guideSession.update({
        where: { id: sessionId },
        data: { status: outcome, completedAt, rewardState },
      });
      await tx.guideRewardEntry.create({
        data: {
          guideId: session.guideId,
          sessionId,
          kind: 'fixed_stipend',
          state: rewardState,
          amountMinor: SESSION_STIPEND_MINOR,
          currency: SESSION_STIPEND_CURRENCY,
          earnedAt: rewardState === 'earned' ? completedAt : null,
          note:
            rewardState === 'withheld'
              ? 'Held pending review. Nothing about this depends on the university’s decision.'
              : null,
        },
      });
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'session.completed',
      objectType: 'session',
      objectId: sessionId,
      metadata: { outcome, rewardState, trustCaseOpen },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'reward.earned',
      objectType: 'reward',
      objectId: sessionId,
      metadata: { state: rewardState, amountMinor: SESSION_STIPEND_MINOR, currency: SESSION_STIPEND_CURRENCY },
    });

    return { status: outcome, rewardState };
  }

  /** The student says the session did not happen as described. */
  async dispute(access: AccessContext, sessionId: string, reason: string) {
    const session = await this.requireParticipant(access, sessionId);
    if (session.studentId !== access.userId) {
      throw AppError.forbidden('Only the student who booked can dispute a session.');
    }

    await this.prisma.guideSession.update({
      where: { id: sessionId },
      data: { disputedAt: new Date(), rewardState: 'withheld' },
    });
    await this.prisma.guideRewardEntry.updateMany({
      where: { sessionId, state: { in: ['not_earned', 'earned'] } },
      data: { state: 'withheld', note: reason },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'reward.state_changed',
      objectType: 'session',
      objectId: sessionId,
      metadata: { to: 'withheld', reason: 'disputed_by_student' },
    });

    return { disputed: true };
  }

  async listForStudent(access: AccessContext) {
    return this.prisma.guideSession.findMany({
      where: { studentId: access.userId },
      orderBy: { scheduledFor: 'desc' },
      include: {
        guide: {
          include: {
            user: { select: { displayName: true } },
            institution: { select: { displayName: true } },
          },
        },
      },
    });
  }

  private async requireParticipant(access: AccessContext, sessionId: string) {
    const session = await this.prisma.guideSession.findUnique({
      where: { id: sessionId },
      include: { guide: { select: { userId: true } } },
    });
    if (session === null) throw AppError.notFound('Session');
    if (session.studentId !== access.userId && session.guide.userId !== access.userId) {
      throw AppError.notFound('Session');
    }
    return session;
  }
}
