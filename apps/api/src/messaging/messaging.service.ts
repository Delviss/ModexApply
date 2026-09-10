import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  MESSAGE_MAX_LENGTH,
  SAFETY_BANNER_TEXT,
  SIGNAL_CASE_TYPE,
  SYSTEM_MESSAGE_TEXT,
  canSendMessage,
  exceedsMessageRate,
  flagSummary,
  groupMessagesByDay,
  guideDisplayName,
  scanMessage,
  suspendsImmediately,
  type AccessContext,
  type ConversationContextType,
  type Message as MessageContract,
} from '@modex/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';
import { systemActor, toAuditActor } from '../auth/audit-actor.js';
import { assertConsent } from '../auth/access-context.js';
import { GuidesService } from '../guides/guides.service.js';
import { TrustService } from '../trust/trust.service.js';

/**
 * In-app messaging (Phase 3 §3, FR-008) and the point at which the anti-scam
 * engine actually runs.
 *
 * The order of operations in `send` is the safety property, so it is worth
 * stating plainly:
 *
 *   authorise   → is this person in this conversation, and may they send at all
 *   rate-limit  → is this a broadcast rather than a conversation
 *   scan        → what does the message say
 *   persist     → message, evidence and case in **one** transaction
 *   act         → suspend, afterwards, once the evidence is committed
 *
 * The scan runs before the write, so a flagged message is stored already
 * flagged. The suspension runs after the commit, so the evidence exists before
 * the action taken on it — which is the whole of "preserve evidence immutably
 * before any moderation action".
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guides: GuidesService,
    private readonly trust: TrustService,
  ) {}

  /** The banner is served with every thread, so the API and the UI agree on it. */
  readonly safetyBanner = SAFETY_BANNER_TEXT;

  /**
   * Opens (or re-opens the handle on) a conversation.
   *
   * Idempotent per student + guide + context: a student who clicks "message
   * this guide" twice from the same programme page gets one conversation, not
   * two half-threads. The unique index in the schema is what makes that true
   * under a double-submit, not this lookup.
   */
  async openConversation(
    access: AccessContext,
    input: { guideId: string; contextType?: ConversationContextType; contextId?: string | null },
  ) {
    const guide = await this.prisma.studentGuide.findUnique({
      where: { id: input.guideId },
      select: { id: true, state: true, userId: true },
    });
    // A guide who is not discoverable is not contactable either, and the answer
    // is the same 404 the directory gives — a suspension is not something an
    // API tells a stranger about.
    if (guide === null || guide.state !== 'active') throw AppError.notFound('Guide');
    if (guide.userId === access.userId) {
      throw AppError.validation('You cannot open a conversation with yourself.', [
        { field: 'guideId', code: 'self', message: 'Pick a different guide.' },
      ]);
    }

    // Consent is a separate, revocable grant (Phase 0 §3.2): being signed in is
    // not consent to be put in touch with another person. The student grants
    // `guide_access` explicitly, and revoking it stops new conversations
    // without deleting the ones they already had.
    assertConsent(access, 'guide_access', guide.id);

    const contextType = input.contextType ?? 'general';
    const contextId = input.contextId ?? null;

    const existing = await this.prisma.conversation.findFirst({
      where: { studentId: access.userId, guideId: guide.id, contextType, contextId },
    });
    if (existing !== null) return this.thread(access, existing.id);

    const conversation = await this.prisma.conversation.create({
      data: { studentId: access.userId, guideId: guide.id, contextType, contextId },
    });

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: null,
        senderRole: 'system',
        kind: 'system',
        systemKind: 'conversation_opened',
        body: SYSTEM_MESSAGE_TEXT.conversation_opened,
      },
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'conversation.opened',
      objectType: 'conversation',
      objectId: conversation.id,
      metadata: { guideId: guide.id, contextType, contextId },
    });

    return this.thread(access, conversation.id);
  }

  /** Every conversation the caller is in, student or guide, most recent first. */
  async listConversations(access: AccessContext) {
    const guide = await this.prisma.studentGuide.findUnique({
      where: { userId: access.userId },
      select: { id: true },
    });

    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [
          { studentId: access.userId },
          ...(guide === null ? [] : [{ guideId: guide.id }]),
        ],
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        guide: { include: { user: { select: { displayName: true } }, institution: { select: { displayName: true } } } },
        student: { select: { displayName: true } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      status: conversation.status,
      contextType: conversation.contextType,
      contextId: conversation.contextId,
      // A guide sees the student's name; a student sees the guide's short name.
      counterpart:
        conversation.studentId === access.userId
          ? {
              kind: 'guide' as const,
              id: conversation.guideId,
              name: guideDisplayName(conversation.guide.user.displayName),
              institutionName: conversation.guide.institution.displayName,
              state: conversation.guide.state,
            }
          : {
              kind: 'student' as const,
              id: conversation.studentId,
              name: conversation.student.displayName,
              institutionName: null,
              state: null,
            },
      lastMessage:
        conversation.messages[0] === undefined
          ? null
          : {
              body: conversation.messages[0].body,
              sentAt: conversation.messages[0].sentAt,
              moderationState: conversation.messages[0].moderationState,
            },
      lastMessageAt: conversation.lastMessageAt,
    }));
  }

  /**
   * One thread.
   *
   * The safety banner comes back with it rather than being a client-side
   * constant: the surface cannot forget to render what the API insists on
   * sending, and a second client written later gets it for free.
   */
  async thread(access: AccessContext, conversationId: string) {
    const { conversation } = await this.requireParticipant(access, conversationId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
    });

    const contracts: MessageContract[] = messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      kind: message.kind,
      systemKind: message.systemKind,
      body: message.body,
      attachmentRef: message.attachmentRef,
      moderationState: message.moderationState,
      flagSummary: message.flagSummary,
      sentAt: message.sentAt.toISOString(),
      readAt: message.readAt?.toISOString() ?? null,
    }));

    return {
      /**
       * Who is reading. Sent explicitly so a client can tell its own messages
       * from the other side's without a second call — and without a student
       * client needing an endpoint that hands out user ids.
       */
      viewerId: access.userId,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        contextType: conversation.contextType,
        contextId: conversation.contextId,
        guideId: conversation.guideId,
        guideState: conversation.guide.state,
        guideName: guideDisplayName(conversation.guide.user.displayName),
        institutionName: conversation.guide.institution.displayName,
      },
      safetyBanner: this.safetyBanner,
      messages: contracts,
      days: groupMessagesByDay(contracts),
    };
  }

  /**
   * Sends a message — the one method in Phase 3 that every acceptance criterion
   * touches.
   */
  async send(access: AccessContext, conversationId: string, body: string, attachmentRef?: string | null) {
    const { conversation, senderRole, guide } = await this.requireParticipant(access, conversationId);

    const decision = canSendMessage({
      senderRole,
      guideState: guide.state,
      conversationStatus: conversation.status,
    });
    if (!decision.allowed) {
      // The code comes from the decision, not from this call site, so a
      // restricted guide and a closed conversation cannot answer with different
      // statuses depending on which branch got there first.
      throw new AppError(decision.code ?? 'forbidden', decision.reason ?? 'You cannot send here.');
    }

    if (body.trim().length === 0) {
      throw AppError.validation('Write something first.', [
        { field: 'body', code: 'empty', message: 'A message cannot be empty.' },
      ]);
    }
    if (body.length > MESSAGE_MAX_LENGTH) {
      throw AppError.validation('That message is too long.', [
        { field: 'body', code: 'too_long', message: `Keep it under ${MESSAGE_MAX_LENGTH} characters.` },
      ]);
    }

    if (senderRole === 'guide') await this.enforceRateLimit(guide.id);

    const assessment = scanMessage(body, senderRole);
    const summary = flagSummary(assessment);
    const opensCase = assessment.action === 'warn_and_open_case';

    // One transaction: the message, the evidence and the case. A crash between
    // any two of them would leave a flagged message with nothing behind it.
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: access.userId,
          senderRole,
          kind: attachmentRef == null ? 'text' : 'attachment',
          body,
          attachmentRef: attachmentRef ?? null,
          moderationState: assessment.findings.length === 0 ? 'clean' : 'flagged',
          flagSummary: summary,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.sentAt },
      });

      if (assessment.findings.length === 0) return created;

      // Opening the case first is deliberate: `message_flags` is append-only, so
      // a flag cannot be updated with a case id afterwards. Opening a case
      // changes nothing about the message — it is not the moderation action.
      const trustCase = opensCase
        ? await this.trust.openCase(
            systemActor(),
            {
              type: SIGNAL_CASE_TYPE[assessment.findings[0]?.signal ?? 'payment_solicitation'],
              reporterId: null,
              targetType: 'guide',
              targetId: guide.id,
              severity: assessment.severity ?? 'medium',
              summary: `Automatic: ${assessment.findings.map((finding) => finding.signal).join(', ')} in a message`,
              description: summary,
              state: 'evidence_preserved',
            },
            tx,
          )
        : null;

      for (const finding of assessment.findings) {
        await tx.messageFlag.create({
          data: {
            messageId: created.id,
            signal: finding.signal,
            severity: finding.severity,
            matches: finding.matches,
            // The message exactly as sent, copied into a table with no update
            // path. The body on `messages` is never edited either, but evidence
            // that lives on the row being moderated is not evidence.
            bodySnapshot: body,
            bodyHash: createHash('sha256').update(body).digest('hex'),
            trustCaseId: trustCase?.id ?? null,
          },
        });
      }

      if (trustCase !== null) {
        await tx.message.create({
          data: {
            conversationId,
            senderId: null,
            senderRole: 'system',
            kind: 'system',
            systemKind: 'risk_flagged',
            body: SYSTEM_MESSAGE_TEXT.risk_flagged,
          },
        });
      }

      return created;
    });

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'message.sent',
      objectType: 'message',
      objectId: message.id,
      metadata: { conversationId, senderRole, flagged: assessment.findings.length > 0 },
    });

    if (assessment.findings.length > 0) {
      await this.audit.record({
        actor: systemActor(),
        action: 'message.flagged',
        objectType: 'message',
        objectId: message.id,
        metadata: {
          signals: assessment.findings.map((finding) => finding.signal),
          severity: assessment.severity,
          guideId: guide.id,
        },
      });
    }

    // The moderation action, after the evidence is committed. Only `critical`
    // suspends without a human: a payment demand or an impersonated admissions
    // officer. Everything else waits for triage, because suspending a real
    // student over a regex is its own kind of harm.
    if (senderRole === 'guide' && suspendsImmediately(assessment.severity)) {
      await this.guides.suspend(
        systemActor(),
        guide.id,
        `Automatic suspension: ${assessment.findings.map((finding) => finding.signal).join(', ')}`,
      );
    }

    return {
      message: {
        id: message.id,
        body: message.body,
        senderRole: message.senderRole,
        moderationState: message.moderationState,
        flagSummary: message.flagSummary,
        sentAt: message.sentAt,
      },
      warning: summary,
      senderNotice: assessment.findings[0]?.senderNotice ?? null,
    };
  }

  /** Marks the other side's messages read. Read state is per participant. */
  async markRead(access: AccessContext, conversationId: string) {
    await this.requireParticipant(access, conversationId);
    const { count } = await this.prisma.message.updateMany({
      where: { conversationId, readAt: null, NOT: { senderId: access.userId } },
      data: { readAt: new Date() },
    });
    return { markedRead: count };
  }

  /**
   * Closes a conversation. Either participant may; it is not a moderation
   * action and it does not delete anything.
   */
  async close(access: AccessContext, conversationId: string) {
    const { conversation } = await this.requireParticipant(access, conversationId);
    if (conversation.status !== 'open') return { status: conversation.status };

    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'closed', closedAt: new Date(), closedReason: 'closed_by_participant' },
      }),
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: null,
          senderRole: 'system',
          kind: 'system',
          systemKind: 'conversation_closed',
          body: SYSTEM_MESSAGE_TEXT.conversation_closed,
        },
      }),
    ]);

    await this.audit.record({
      actor: toAuditActor(access),
      action: 'conversation.closed',
      objectType: 'conversation',
      objectId: conversationId,
      metadata: { closedBy: access.userId },
    });

    return { status: 'closed' as const };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Resolves the caller's role in this conversation, or 404s.
   *
   * A non-participant gets "not found" rather than "forbidden": confirming that
   * a conversation exists between two named people is itself a disclosure.
   */
  private async requireParticipant(access: AccessContext, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        guide: {
          include: {
            user: { select: { displayName: true } },
            institution: { select: { displayName: true } },
          },
        },
      },
    });
    if (conversation === null) throw AppError.notFound('Conversation');

    const senderRole: 'student' | 'guide' =
      conversation.studentId === access.userId
        ? 'student'
        : conversation.guide.userId === access.userId
          ? 'guide'
          : (() => {
              throw AppError.notFound('Conversation');
            })();

    return { conversation, senderRole, guide: conversation.guide };
  }

  /**
   * Message spam (TRD §14): high outbound volume across many students.
   *
   * Rate-limited *and* queued for review, because the two answer different
   * questions — the limit protects the students being messaged now, the case
   * asks whether this account should still be sending at all.
   */
  private async enforceRateLimit(guideId: string): Promise<void> {
    const since = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.message.findMany({
      where: {
        sentAt: { gte: since },
        senderRole: 'guide',
        conversation: { guideId },
      },
      select: { conversationId: true },
    });

    const counts = {
      messagesLastHour: recent.length,
      distinctRecipientsLastHour: new Set(recent.map((message) => message.conversationId)).size,
    };
    if (!exceedsMessageRate(counts)) return;

    await this.trust.openCase(systemActor(), {
      type: 'spam',
      reporterId: null,
      targetType: 'guide',
      targetId: guideId,
      severity: 'medium',
      summary: `Automatic: ${counts.messagesLastHour} messages to ${counts.distinctRecipientsLastHour} students in an hour`,
    });

    throw new AppError(
      'rate_limited',
      'You have sent a lot of messages in a short time. Give it an hour — a member of the Trust team will also take a look.',
    );
  }
}
