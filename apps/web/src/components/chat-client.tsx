'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  ChatLayout,
  MessageComposer,
  MessageThread,
  type ChatConversationSummary,
} from '@modex/ui';
import type { ConversationStatus, Message } from '@modex/contracts';

/**
 * The messaging surface (Phase 3 §3).
 *
 * Everything load-bearing happens on the server: whether this person may send,
 * what the anti-scam engine made of the message, whether a case opened. This
 * component sends and re-renders what comes back — it never decides that a
 * message is fine, and it never hides one that was flagged.
 *
 * The thread is polled rather than pushed. The TRD names a WebSocket gateway
 * and that is the right end state; what is here is the same API surface behind
 * a poll, so the upgrade is a transport change rather than a rewrite. The
 * honest trade-off: a message can take up to ten seconds to appear.
 */
const POLL_INTERVAL_MS = 10_000;

export interface ThreadPayload {
  viewerId: string;
  conversation: {
    id: string;
    status: ConversationStatus;
    guideId: string;
    guideState: string;
    guideName: string;
    institutionName: string;
  };
  safetyBanner: string;
  messages: Message[];
}

export interface ChatClientProps {
  conversations: ChatConversationSummary[];
  initialThread: ThreadPayload | null;
}

export function ChatClient({ conversations, initialThread }: ChatClientProps) {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('conversation') ?? conversations[0]?.id ?? null;

  const [thread, setThread] = useState<ThreadPayload | null>(initialThread);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/conversations/${conversationId}`, { cache: 'no-store' });
    if (!response.ok) return;
    setThread((await response.json()) as ThreadPayload);
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    void load(selectedId);
    const timer = setInterval(() => void load(selectedId), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [selectedId, load]);

  const disabledReason = useMemo(() => {
    if (thread === null) return 'Pick a conversation.';
    if (thread.conversation.status === 'suspended') {
      return 'This conversation is suspended while Modex Trust reviews it. Nothing here has been deleted.';
    }
    if (thread.conversation.status === 'closed') return 'This conversation is closed.';
    return null;
  }, [thread]);

  async function send(body: string): Promise<void> {
    if (thread === null) return;
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/conversations/${thread.conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(payload?.error?.message ?? 'We could not send that message.');
      return;
    }

    const result = (await response.json()) as { senderNotice: string | null };
    // The sender is told when their own message tripped a rule. Silently
    // flagging somebody and letting them carry on is how a warning arrives too
    // late to change anything.
    if (result.senderNotice !== null) setNotice(result.senderNotice);
    await load(thread.conversation.id);
  }

  async function report(targetType: 'message' | 'conversation', targetId: string): Promise<void> {
    const description = window.prompt(
      'What happened? A sentence or two is enough — Modex Trust reads every report.',
    );
    if (description === null || description.trim().length < 10) return;

    const response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, type: 'other', description }),
    });
    setNotice(
      response.ok
        ? 'Thank you. Modex Trust has this conversation and will look at it.'
        : 'We could not send that report. Try again in a moment.',
    );
    if (thread !== null) await load(thread.conversation.id);
  }

  return (
    <ChatLayout
      conversations={conversations}
      selectedId={selectedId}
      onSelect={(id) => router.push(`/messages?conversation=${id}`)}
      header={
        thread === null ? (
          <h2 className="mx-card__title">Your conversations</h2>
        ) : (
          <>
            <h2 className="mx-card__title">{thread.conversation.guideName}</h2>
            <p className="mx-card__description">
              Current student at {thread.conversation.institutionName}
            </p>
          </>
        )
      }
      headerActions={
        thread === null ? null : (
          <>
            {/* Report and block, one interaction from the thread. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void report('conversation', thread.conversation.id)}
            >
              Report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await fetch(`/api/conversations/${thread.conversation.id}/close`, { method: 'POST' });
                await load(thread.conversation.id);
              }}
            >
              Block and close
            </Button>
          </>
        )
      }
    >
      {notice === null ? null : <Alert tone="warning">{notice}</Alert>}
      {error === null ? null : (
        <Alert tone="danger" title="That message was not sent">
          {error}
        </Alert>
      )}

      {thread === null ? (
        <p className="mx-card__description">
          Pick a conversation, or find a student guide from a university page.
        </p>
      ) : (
        <>
          <MessageThread
            messages={thread.messages}
            currentUserId={thread.viewerId}
            onReport={(messageId) => void report('message', messageId)}
          />
          <MessageComposer onSend={send} disabledReason={disabledReason} />
        </>
      )}
    </ChatLayout>
  );
}
