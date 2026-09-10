import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  SAFETY_BANNER_TEXT,
  type Message,
  type PublicGuideProfile,
} from '@modex/contracts';
import { SafetyBanner } from '../src/signature/safety-banner.js';
import { RiskInterstitial } from '../src/signature/risk-interstitial.js';
import { ExpiryCountdown } from '../src/signature/expiry-countdown.js';
import { GuideCard } from '../src/blocks/guide-card.js';
import { ChatLayout, MessageComposer, MessageThread } from '../src/blocks/chat.js';
import { SlotPicker } from '../src/blocks/slot-picker.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function guide(overrides: Partial<PublicGuideProfile> = {}): PublicGuideProfile {
  return {
    id: 'guide_1',
    displayName: 'Amara O.',
    avatarRef: null,
    institutionId: 'inst_1',
    institutionName: 'University of Example',
    campusId: 'campus_1',
    campusName: 'City campus',
    programKey: 'prog_cs',
    programName: 'BSc Computer Science',
    level: 'undergraduate',
    yearOfStudy: 2,
    languages: ['English', 'Yoruba'],
    homeCountry: 'NG',
    topics: ['accommodation', 'cost_of_living'],
    bio: 'Second year, happy to talk about halls.',
    state: 'active',
    verifiedAt: '2026-03-01T00:00:00.000Z',
    expiresAt: '2026-08-30T00:00:00.000Z',
    responseTimeHours: 4,
    online: true,
    trustScore: 80,
    universityEndorsed: false,
    ...overrides,
  };
}

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

describe('<SafetyBanner>', () => {
  /**
   * The design rule from issue #5: permanent, not a dismissible toast. A
   * warning a scammer can talk you into hiding is worse than none, so this test
   * guards the absence of a control as carefully as others guard a presence.
   */
  it('cannot be dismissed', () => {
    const { container } = render(<SafetyBanner />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /dismiss|close|hide|got it/i })).toBeNull();
  });

  it('says the three things a student needs to know', () => {
    render(<SafetyBanner />);
    const banner = screen.getByRole('complementary', { name: /safety notice/i });
    const text = banner.textContent ?? '';
    expect(text).toBe(SAFETY_BANNER_TEXT);
    expect(text).toMatch(/never collect tuition/i);
    expect(text).toMatch(/cannot guarantee admission or a visa/i);
    expect(text).toMatch(/report anything that sounds like a payment request/i);
  });

  it('renders the report control inline when one is given', () => {
    render(<SafetyBanner action={<button type="button">Report</button>} />);
    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument();
  });
});

describe('<RiskInterstitial>', () => {
  it('shows the flagged message rather than removing it', () => {
    render(
      <RiskInterstitial warning="This message looks like a request for money.">
        <p>Send me the deposit today.</p>
      </RiskInterstitial>,
    );

    // Both halves: what was said, and why it was flagged.
    expect(screen.getByText('Send me the deposit today.')).toBeInTheDocument();
    expect(screen.getByText(/looks like a request for money/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Modex flagged this message/i);
  });

  it('keeps the report action one interaction away', () => {
    const onReport = vi.fn();
    render(
      <RiskInterstitial
        warning="Payment request."
        action={
          <button type="button" onClick={onReport}>
            Report this
          </button>
        }
      >
        <p>…</p>
      </RiskInterstitial>,
    );
    fireEvent.click(screen.getByRole('button', { name: /report this/i }));
    expect(onReport).toHaveBeenCalledOnce();
  });
});

describe('<ExpiryCountdown>', () => {
  it('turns amber at 30 days and red at 7, and says so in words', () => {
    const { container, rerender } = render(
      <ExpiryCountdown expiresAt="2026-12-01T00:00:00.000Z" now={NOW} />,
    );
    expect(container.firstChild).toHaveAttribute('data-urgency', 'none');

    rerender(<ExpiryCountdown expiresAt="2026-06-20T00:00:00.000Z" now={NOW} />);
    expect(container.firstChild).toHaveAttribute('data-urgency', 'due');
    expect(container.textContent).toMatch(/19 days/);

    rerender(<ExpiryCountdown expiresAt="2026-06-05T00:00:00.000Z" now={NOW} />);
    expect(container.firstChild).toHaveAttribute('data-urgency', 'urgent');
    expect(container.textContent).toMatch(/winding your account down/i);

    rerender(<ExpiryCountdown expiresAt="2026-05-20T00:00:00.000Z" now={NOW} />);
    expect(container.firstChild).toHaveAttribute('data-urgency', 'lapsed');
    expect(container.textContent).toMatch(/conversations are still here/i);
  });

  it('says what is missing when there is no evidence at all', () => {
    render(<ExpiryCountdown expiresAt={null} now={NOW} />);
    expect(screen.getByText(/no current-student evidence/i)).toBeInTheDocument();
  });
});

describe('<GuideCard>', () => {
  it('shows the verification badge, the match reason and the topics', () => {
    render(
      <GuideCard
        guide={guide()}
        matchReason="Answers questions about accommodation and speaks English."
        now={NOW}
      />,
    );
    expect(screen.getByText('Amara O.')).toBeInTheDocument();
    // The badge label, plus the same state repeated for assistive technology.
    expect(screen.getAllByText(/Verified/).length).toBeGreaterThan(0);
    expect(screen.getByText(/accommodation and speaks English/i)).toBeInTheDocument();
    expect(screen.getByText('Accommodation')).toBeInTheDocument();
    expect(screen.getByText('English, Yoruba')).toBeInTheDocument();
  });

  it('rings the avatar only for a verified guide', () => {
    const { container, rerender } = render(<GuideCard guide={guide()} now={NOW} />);
    expect(container.querySelector('.mx-guide-card__avatar')).toHaveAttribute(
      'data-verified',
      'true',
    );

    rerender(<GuideCard guide={guide({ state: 'restricted' })} now={NOW} />);
    expect(container.querySelector('.mx-guide-card__avatar')).toHaveAttribute(
      'data-verified',
      'false',
    );
    // And the badge stops claiming verification, which is the load-bearing half.
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('never calls a guide university staff unless the university said so', () => {
    const { rerender } = render(<GuideCard guide={guide()} now={NOW} />);
    expect(screen.queryByText(/recognised by the university/i)).toBeNull();
    rerender(<GuideCard guide={guide({ universityEndorsed: true })} now={NOW} />);
    expect(screen.getByText(/recognised by the university/i)).toBeInTheDocument();
  });
});

describe('the chat thread', () => {
  it('announces messages in a live region', () => {
    render(<MessageThread messages={[message()]} currentUserId="student_1" />);
    const log = screen.getByRole('log', { name: /messages/i });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByText(/Halls are about 140 a week/)).toBeInTheDocument();
  });

  it('puts a flagged message behind an interstitial without hiding it', () => {
    render(
      <MessageThread
        messages={[
          message({
            id: 'flagged',
            moderationState: 'flagged',
            body: 'Transfer the money to my account.',
            flagSummary: 'This message looks like a request for money.',
          }),
        ]}
        currentUserId="student_1"
        onReport={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/flagged this message/i);
    expect(screen.getByText('Transfer the money to my account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /report this/i })).toBeInTheDocument();
  });

  it('marks a system message as something no person said', () => {
    const { container } = render(
      <MessageThread
        messages={[
          message({
            id: 'sys',
            senderRole: 'system',
            senderId: null,
            kind: 'system',
            systemKind: 'guide_suspended',
            body: 'This guide has been suspended and can no longer reply.',
          }),
        ]}
        currentUserId="student_1"
      />,
    );
    const system = container.querySelector('.mx-chat__system');
    expect(system).toHaveAttribute('data-kind', 'guide_suspended');
    expect(system?.textContent).toMatch(/suspended/i);
  });

  it('groups messages under a day divider', () => {
    render(
      <MessageThread
        messages={[
          message({ id: 'a', sentAt: '2026-05-30T09:00:00.000Z' }),
          message({ id: 'b', sentAt: '2026-05-31T09:00:00.000Z' }),
        ]}
        currentUserId="student_1"
      />,
    );
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(2);
  });

  it('reports a message in one interaction, not through a menu', () => {
    const onReport = vi.fn();
    render(<MessageThread messages={[message()]} currentUserId="student_1" onReport={onReport} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    expect(onReport).toHaveBeenCalledWith('msg_1');
  });
});

describe('<MessageComposer>', () => {
  it('sends on Enter and breaks the line on Shift+Enter', async () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);
    const input = screen.getByLabelText(/write a message/i);

    fireEvent.change(input, { target: { value: 'How much are halls?' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('How much are halls?');
  });

  it('is reachable by keyboard alone through a real submit button', () => {
    render(<MessageComposer onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: /send/i })).toHaveAttribute('type', 'submit');
  });

  it('explains why it is disabled rather than just being dead', () => {
    render(
      <MessageComposer
        onSend={vi.fn()}
        disabledReason="This guide’s student status is being rechecked."
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/being rechecked/i);
  });
});

describe('<ChatLayout>', () => {
  it('renders the safety banner itself, so no page can omit it', () => {
    render(
      <ChatLayout
        conversations={[
          { id: 'c1', name: 'Amara O.', status: 'open', lastMessage: 'Halls are fine' },
        ]}
        selectedId="c1"
        headerActions={<button type="button">Report</button>}
        header={<h2>Amara O.</h2>}
      >
        <p>Thread</p>
      </ChatLayout>,
    );
    expect(screen.getByRole('complementary', { name: /safety notice/i })).toBeInTheDocument();
    // Report is in the header, one interaction from the thread.
    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument();
  });

  it('marks a suspended conversation in the list', () => {
    render(
      <ChatLayout
        conversations={[{ id: 'c1', name: 'Amara O.', status: 'suspended' }]}
        header={null}
      >
        <p>Thread</p>
      </ChatLayout>,
    );
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });
});

describe('<SlotPicker>', () => {
  const slots = [
    {
      id: 'slot_free',
      startsAt: '2026-07-01T09:00:00.000Z',
      endsAt: '2026-07-01T09:30:00.000Z',
      topics: ['accommodation' as const],
      bookable: true,
      blockedReason: null,
    },
    {
      id: 'slot_full',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T10:30:00.000Z',
      topics: [],
      bookable: false,
      blockedReason: 'Fully booked.',
    },
  ];

  it('shows a full slot, disabled, with the reason beside it', () => {
    render(<SlotPicker slots={slots} timeZone="UTC" />);
    expect(screen.getByText('Fully booked.')).toBeInTheDocument();
    // One bookable slot means exactly one Book button.
    expect(screen.getAllByRole('button', { name: 'Book' })).toHaveLength(1);
  });

  it('names the timezone the times are shown in', () => {
    render(<SlotPicker slots={slots} timeZone="Europe/London" />);
    expect(screen.getByText(/times shown in Europe\/London/i)).toBeInTheDocument();
  });

  it('books the slot the student picked', () => {
    const onBook = vi.fn();
    render(<SlotPicker slots={slots} timeZone="UTC" onBook={onBook} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(onBook).toHaveBeenCalledWith('slot_free');
  });

  it('says what to do instead when a guide has offered nothing', () => {
    render(<SlotPicker slots={[]} timeZone="UTC" />);
    expect(screen.getByText(/send them a message instead/i)).toBeInTheDocument();
  });
});
