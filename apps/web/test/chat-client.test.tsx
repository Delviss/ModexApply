import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@modex/contracts';
import { ChatClient, type ThreadPayload } from '@/components/chat-client';

/**
 * The messaging surface never decides anything about safety — the server does —
 * so these tests are about what it *shows*: the permanent banner, the flagged
 * message left visible, and the notice a sender gets about their own message.
 */
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('conversation=conv_1'),
}));

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    conversationId: 'conv_1',
    senderId: 'guide_user',
    senderRole: 'guide',
    kind: 'text',
    systemKind: null,
    body: 'Halls are about 140 a week.',
    attachmentRef: null,
    moderationState: 'clean',
    flagSummary: null,
    sentAt: '2026-06-01T09:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

function thread(overrides: Partial<ThreadPayload> = {}): ThreadPayload {
  return {
    viewerId: 'student_1',
    conversation: {
      id: 'conv_1',
      status: 'open',
      guideId: 'guide_1',
      guideState: 'active',
      guideName: 'Amara O.',
      institutionName: 'University of Example',
    },
    safetyBanner: 'Guides never collect tuition…',
    messages: [message()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(thread()), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const conversations = [
  { id: 'conv_1', name: 'Amara O.', status: 'open' as const, lastMessage: 'Halls…' },
];

describe('<ChatClient>', () => {
  it('shows the safety banner and the report controls without any interaction', () => {
    render(<ChatClient conversations={conversations} initialThread={thread()} />);
    expect(screen.getByRole('complementary', { name: /safety notice/i })).toBeInTheDocument();
    // Two report controls, deliberately: one for the conversation in the header
    // and one on each message. Neither is behind an overflow menu.
    expect(screen.getAllByRole('button', { name: /report/i }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /block and close/i })).toBeInTheDocument();
  });

  it('keeps a flagged message readable, with the warning above it', () => {
    render(
      <ChatClient
        conversations={conversations}
        initialThread={thread({
          messages: [
            message({
              moderationState: 'flagged',
              body: 'Transfer the money to my account.',
              flagSummary: 'This message looks like a request for money.',
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Transfer the money to my account.')).toBeInTheDocument();
    expect(screen.getByText(/looks like a request for money/i)).toBeInTheDocument();
  });

  it('tells the sender when their own message tripped a rule', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ senderNotice: 'Keep the conversation on Modex.' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(thread()), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatClient conversations={conversations} initialThread={thread()} />);
    fireEvent.change(screen.getByLabelText(/write a message/i), {
      target: { value: 'add me on whatsapp' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(screen.getByText(/keep the conversation on modex/i)).toBeInTheDocument(),
    );
  });

  it('disables the composer on a suspended conversation and says why', () => {
    render(
      <ChatClient
        conversations={conversations}
        initialThread={thread({
          conversation: {
            id: 'conv_1',
            status: 'suspended',
            guideId: 'guide_1',
            guideState: 'suspended',
            guideName: 'Amara O.',
            institutionName: 'University of Example',
          },
        })}
      />,
    );
    expect(screen.queryByLabelText(/write a message/i)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/suspended while Modex Trust reviews/i);
    // Nothing is hidden: the thread is still there to read.
    expect(screen.getByText('Halls are about 140 a week.')).toBeInTheDocument();
  });
});
