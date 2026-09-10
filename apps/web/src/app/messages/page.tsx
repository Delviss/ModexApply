import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ChatConversationSummary } from '@modex/ui';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { ChatClient, type ThreadPayload } from '@/components/chat-client';

export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false },
};

interface ConversationRow {
  id: string;
  status: ChatConversationSummary['status'];
  counterpart: { kind: 'guide' | 'student'; name: string; institutionName: string | null };
  lastMessage: { body: string; sentAt: string } | null;
  lastMessageAt: string | null;
}

/**
 * Messages (Phase 3 §3).
 *
 * Server-rendered and never cached — `apiGetAs` sets `cache: 'no-store'`, which
 * on a page carrying other people's private conversations is the difference
 * between a chat and an incident.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/messages');

  const { conversation: requested } = await searchParams;

  let rows: ConversationRow[] = [];
  try {
    rows = (await apiGetAs<{ data: ConversationRow[] }>('/conversations', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/messages');
    throw error;
  }

  const selectedId = requested ?? rows[0]?.id ?? null;
  let thread: ThreadPayload | null = null;
  if (selectedId !== null) {
    try {
      thread = await apiGetAs<ThreadPayload>(`/conversations/${selectedId}`, token);
    } catch (error) {
      // A conversation id in the URL that is not yours answers 404, and the
      // page shows the list rather than an error: the API already refused, and
      // there is nothing here worth a stack trace.
      if (!(error instanceof ApiError)) throw error;
    }
  }

  const conversations: ChatConversationSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.counterpart.name,
    subtitle: row.counterpart.institutionName,
    lastMessage: row.lastMessage?.body ?? null,
    lastMessageAt: row.lastMessageAt,
    status: row.status,
  }));

  return (
    <main className="mx-messages-page">
      <h1 className="mx-visually-hidden">Your messages</h1>
      <ChatClient conversations={conversations} initialThread={thread} />
    </main>
  );
}
