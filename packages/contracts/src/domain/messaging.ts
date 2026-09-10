import { z } from 'zod';
import { canGuideSendMessages, guideBlockReason, type GuideState } from './guides.js';

/**
 * Conversations and messages (Phase 3 §3, FR-008).
 *
 * The load-bearing decision in this module is that a *message* is never the
 * unit of trust. A message carries a moderation state and, when it is flagged,
 * the evidence of why — and none of that is stored on the message row itself,
 * because a moderation action that edits its own evidence is not evidence. See
 * `trust.ts`.
 */

export const CONVERSATION_CONTEXT_TYPES = [
  'institution',
  'program',
  'application',
  'general',
] as const;

export type ConversationContextType = (typeof CONVERSATION_CONTEXT_TYPES)[number];

/**
 * Conversation states.
 *
 * `suspended` is not the same as `closed`: a closed conversation was finished
 * by the people in it, a suspended one was stopped by the platform. A student
 * whose guide was suspended must be able to tell the difference — Phase 3
 * acceptance criterion 8 — so the two are separate states with separate system
 * messages, not one state with a nullable reason.
 */
export const CONVERSATION_STATUSES = ['open', 'closed', 'suspended', 'archived'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_MODERATION_STATES = ['clean', 'flagged', 'withheld', 'under_review'] as const;
export type MessageModerationState = (typeof MESSAGE_MODERATION_STATES)[number];

export const MESSAGE_KINDS = ['text', 'attachment', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * System messages the platform writes into a thread. Enumerated rather than
 * free text so the client can render them distinctly and a translation exists
 * for each — a safety notice that arrives as an untranslated English string is
 * a safety notice half the audience cannot read.
 */
export const SYSTEM_MESSAGE_KINDS = [
  'conversation_opened',
  'guide_restricted',
  'guide_suspended',
  'conversation_closed',
  'risk_flagged',
  'session_booked',
  'session_cancelled',
  'report_submitted',
] as const;

export type SystemMessageKind = (typeof SYSTEM_MESSAGE_KINDS)[number];

export const SYSTEM_MESSAGE_TEXT: Readonly<Record<SystemMessageKind, string>> = Object.freeze({
  conversation_opened:
    'This conversation is with a verified current student. Modex checks their student status and rechecks it every six months.',
  guide_restricted:
    'This guide’s student status is being rechecked, so they cannot send messages at the moment. Everything you have both said is still here.',
  guide_suspended:
    'This guide has been suspended and can no longer reply. Nothing you shared here was sent to the university. You can ask Modex to match you with another guide.',
  conversation_closed: 'This conversation was closed.',
  risk_flagged:
    'Modex flagged a message in this conversation. It is still shown to you, with an explanation of what was flagged.',
  session_booked: 'A session was booked through Modex. Payment never goes to a guide.',
  session_cancelled: 'A booked session was cancelled.',
  report_submitted:
    'A report was sent to Modex Trust. Somebody will look at this conversation; you do not need to do anything else.',
});

/**
 * The safety banner (Phase 3 design spec).
 *
 * Permanent in every thread, never a dismissible toast — a warning that
 * disappears after five seconds is a warning designed to be missed. The text
 * lives here rather than in the component so the API can hold the surface to
 * the same wording it enforces.
 */
export const SAFETY_BANNER_TEXT =
  'Guides never collect tuition or application fees, and cannot guarantee admission or a visa. Report anything that sounds like a payment request.';

export const ConversationSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  guideId: z.string(),
  contextType: z.enum(CONVERSATION_CONTEXT_TYPES),
  /** Programme key, institution id or application id. Null for `general`. */
  contextId: z.string().nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string().nullable(),
  senderRole: z.enum(['student', 'guide', 'system']),
  kind: z.enum(MESSAGE_KINDS),
  systemKind: z.enum(SYSTEM_MESSAGE_KINDS).nullable(),
  body: z.string(),
  /** Document version id, for an attachment. The vault rules still apply. */
  attachmentRef: z.string().nullable(),
  moderationState: z.enum(MESSAGE_MODERATION_STATES),
  /**
   * What was flagged, in words both parties read. Null on a clean message. The
   * message body is *not* modified — the student sees what was said and why it
   * was flagged (Phase 3 design spec).
   */
  flagSummary: z.string().nullable(),
  sentAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

export type Message = z.infer<typeof MessageSchema>;

export const MESSAGE_MAX_LENGTH = 4_000;

export const SendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(MESSAGE_MAX_LENGTH),
  attachmentRef: z.string().nullable().optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export interface SendDecision {
  allowed: boolean;
  /** Error code the API should answer with. Null when allowed. */
  code: 'forbidden' | 'state_transition_rejected' | null;
  reason: string | null;
}

/**
 * **Whether this message may be sent at all**, decided before the body is even
 * looked at.
 *
 * Both halves matter and both are checked server-side. A guide whose evidence
 * lapsed cannot send, whatever the client renders (acceptance criterion 1); and
 * nobody sends into a suspended conversation, or the system message announcing
 * a suspension would be followed by more messages from the suspended guide.
 */
export function canSendMessage(input: {
  senderRole: 'student' | 'guide';
  guideState: GuideState;
  conversationStatus: ConversationStatus;
}): SendDecision {
  if (input.conversationStatus !== 'open') {
    return {
      allowed: false,
      code: 'state_transition_rejected',
      reason:
        input.conversationStatus === 'suspended'
          ? 'This conversation is suspended while Modex Trust reviews it.'
          : 'This conversation is closed.',
    };
  }

  if (input.senderRole === 'guide' && !canGuideSendMessages(input.guideState)) {
    return { allowed: false, code: 'forbidden', reason: guideBlockReason(input.guideState) };
  }

  // A student may always write to an open conversation. If their guide has been
  // restricted the conversation is closed by the sweep, not left open for a
  // student to shout into.
  return { allowed: true, code: null, reason: null };
}

/**
 * Read state for one participant. Kept out of `Message` because "read" is a
 * property of a person looking at a thread, not of the message itself, and
 * putting it on the row is how one participant's read marks another's.
 */
export const ConversationReadStateSchema = z.object({
  conversationId: z.string(),
  participantId: z.string(),
  lastReadAt: z.iso.datetime().nullable(),
  unreadCount: z.number().int().min(0),
});

export type ConversationReadState = z.infer<typeof ConversationReadStateSchema>;

/**
 * Day dividers, computed once here so the two-pane thread and any future
 * surface group messages identically. UTC dates: a divider that moves when the
 * reader flies to another timezone is a bug people report as "my messages
 * disappeared".
 */
export function groupMessagesByDay(
  messages: readonly Message[],
): { day: string; messages: Message[] }[] {
  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const day = message.sentAt.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket === undefined) groups.set(day, [message]);
    else bucket.push(message);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, dayMessages]) => ({ day, messages: dayMessages }));
}
