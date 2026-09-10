'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  SYSTEM_MESSAGE_TEXT,
  groupMessagesByDay,
  type ConversationStatus,
  type Message,
} from '@modex/contracts';
import { Button } from '../primitives/button.js';
import { Badge } from '../primitives/badge.js';
import { FlagIcon, PaperclipIcon, SendIcon, SlashIcon } from '../primitives/icons.js';
import { SafetyBanner } from '../signature/safety-banner.js';
import { RiskInterstitial } from '../signature/risk-interstitial.js';
import { usePrefersReducedMotion } from '../lib/motion.js';
import { formatDayDivider } from '../lib/format.js';
import { cn } from '../lib/cn.js';

/**
 * The two-pane messaging shell — `@rayimanoj8/chat-template`'s layout with
 * `@serafimcloud/agent-chat`'s composer and per-message error states, re-themed.
 *
 * What the vendor blocks do not have, and what this phase is actually about:
 *
 *  - A **permanent** safety banner. Both vendors' equivalents are dismissible
 *    toasts; this one has no dismiss control and no prop that adds one.
 *  - A **risk interstitial** above a flagged message rather than a deletion.
 *    `agent-chat`'s per-message error state is the right shape; what it carries
 *    is different — the message is not broken, it is suspect, and it stays
 *    readable.
 *  - **Report and block within one interaction** of every surface. The vendor
 *    overflow menus bury destructive actions two clicks deep by default, which
 *    is exactly wrong here.
 *  - Messages land in an **ARIA live region**, and every animation is gated
 *    behind `prefers-reduced-motion`.
 */

export interface ChatConversationSummary {
  id: string;
  name: string;
  subtitle?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unread?: number;
  status: ConversationStatus;
}

export interface ConversationListProps {
  conversations: readonly ChatConversationSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Rendered when there is nothing yet — the empty state belongs to the page. */
  empty?: ReactNode;
  className?: string;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  empty,
  className,
}: ConversationListProps) {
  if (conversations.length === 0 && empty !== undefined) {
    return <div className={cn('mx-chat__list', className)}>{empty}</div>;
  }

  return (
    <nav className={cn('mx-chat__list', className)} aria-label="Conversations">
      <ul>
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className="mx-chat__list-item"
              data-selected={conversation.id === selectedId}
              aria-current={conversation.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect?.(conversation.id)}
            >
              <span className="mx-chat__list-name">
                {conversation.name}
                {conversation.status === 'suspended' ? (
                  <Badge tone="danger">Suspended</Badge>
                ) : conversation.status === 'closed' ? (
                  <Badge tone="neutral">Closed</Badge>
                ) : null}
              </span>
              {conversation.subtitle == null ? null : (
                <span className="mx-chat__list-subtitle">{conversation.subtitle}</span>
              )}
              {conversation.lastMessage == null ? null : (
                <span className="mx-chat__list-preview">{conversation.lastMessage}</span>
              )}
              {conversation.unread !== undefined && conversation.unread > 0 ? (
                <span className="mx-chat__unread">{conversation.unread} unread</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface MessageThreadProps {
  messages: readonly Message[];
  /** Which side of the thread the reader is on. */
  currentUserId: string;
  /** Report is always visible; never behind an overflow menu. */
  onReport?: (messageId: string) => void;
  typing?: boolean;
  className?: string;
}

export function MessageThread({
  messages,
  currentUserId,
  onReport,
  typing = false,
  className,
}: MessageThreadProps) {
  const reducedMotion = usePrefersReducedMotion();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `auto` under reduced motion: a smooth scroll is an animation, and this one
    // fires on every arriving message.
    //
    // Feature-detected because `scrollIntoView` is absent in jsdom and in some
    // embedded browsers, and a thread that throws on its first render is worse
    // than a thread that does not scroll itself.
    const end = endRef.current;
    if (typeof end?.scrollIntoView !== 'function') return;
    end.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, reducedMotion]);

  const days = groupMessagesByDay([...messages]);

  return (
    <div className={cn('mx-chat__thread', className)} data-reduced-motion={reducedMotion}>
      {/*
        `log` with polite announcements: a screen-reader user hears arriving
        messages without having them interrupt what they are already reading.
      */}
      <div className="mx-chat__messages" role="log" aria-live="polite" aria-label="Messages">
        {days.map((day) => (
          <section key={day.day} aria-label={formatDayDivider(day.day)}>
            <p className="mx-chat__divider">
              <span>{formatDayDivider(day.day)}</span>
            </p>
            {day.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                mine={message.senderId === currentUserId}
                onReport={onReport}
              />
            ))}
          </section>
        ))}
        {typing ? (
          <p className="mx-chat__typing" aria-live="polite">
            <span aria-hidden="true">···</span> Typing…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  onReport,
}: {
  message: Message;
  mine: boolean;
  onReport?: (messageId: string) => void;
}) {
  if (message.senderRole === 'system') {
    return (
      <p className="mx-chat__system" data-kind={message.systemKind ?? 'system'}>
        {message.body === '' && message.systemKind !== null
          ? SYSTEM_MESSAGE_TEXT[message.systemKind]
          : message.body}
      </p>
    );
  }

  const bubble = (
    <div className="mx-chat__bubble" data-mine={mine} data-flagged={message.moderationState !== 'clean'}>
      <p className="mx-chat__body">{message.body}</p>
      {message.attachmentRef === null ? null : (
        <p className="mx-chat__attachment">
          <PaperclipIcon size={14} /> Attachment
        </p>
      )}
      <p className="mx-chat__time">
        <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
        {message.readAt === null ? null : <span className="mx-visually-hidden"> · Read</span>}
      </p>
    </div>
  );

  if (message.moderationState === 'clean' || message.flagSummary === null) {
    return (
      <div className="mx-chat__row" data-mine={mine}>
        {bubble}
        {onReport === undefined ? null : (
          <button
            type="button"
            className="mx-chat__report"
            onClick={() => onReport(message.id)}
          >
            <FlagIcon size={14} /> Report
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-chat__row" data-mine={mine}>
      <RiskInterstitial
        warning={message.flagSummary}
        action={
          onReport === undefined ? undefined : (
            <Button size="sm" variant="secondary" onClick={() => onReport(message.id)}>
              <FlagIcon size={14} /> Report this
            </Button>
          )
        }
      >
        {bubble}
      </RiskInterstitial>
    </div>
  );
}

export interface MessageComposerProps {
  onSend: (body: string) => void | Promise<void>;
  /** Why sending is off — a restricted guide, a suspended conversation. */
  disabledReason?: string | null;
  placeholder?: string;
  className?: string;
}

export function MessageComposer({
  onSend,
  disabledReason = null,
  placeholder = 'Write a message',
  className,
}: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  if (disabledReason !== null) {
    return (
      <p className={cn('mx-chat__disabled', className)} role="status">
        <SlashIcon size={16} /> {disabledReason}
      </p>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = value.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={cn('mx-chat__composer', className)} onSubmit={submit}>
      <label className="mx-visually-hidden" htmlFor="mx-chat-composer">
        Write a message
      </label>
      <textarea
        id="mx-chat-composer"
        className="mx-chat__input"
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter breaks the line. Both are reachable from
          // the keyboard alone, and the submit button below is a real button, so
          // nothing here depends on knowing the shortcut.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit(event);
          }
        }}
      />
      <Button type="submit" size="md" disabled={sending || value.trim().length === 0}>
        <SendIcon size={16} /> Send
      </Button>
    </form>
  );
}

export interface ChatLayoutProps {
  conversations: readonly ChatConversationSummary[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Report and block for the whole conversation, one interaction away. */
  headerActions?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The shell. The safety banner is rendered by the layout rather than by the
 * page, so no surface that shows a thread can omit it.
 */
export function ChatLayout({
  conversations,
  selectedId,
  onSelect,
  header,
  headerActions,
  children,
  className,
}: ChatLayoutProps) {
  return (
    <div className={cn('mx-chat', className)}>
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <div className="mx-chat__pane">
        <header className="mx-chat__header">
          <div>{header}</div>
          <div className="mx-chat__header-actions">{headerActions}</div>
        </header>
        <SafetyBanner />
        {children}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
