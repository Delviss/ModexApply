import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_REWARD_INPUTS,
  RewardLinkageError,
  canTransitionReward,
  canTransitionSession,
  conflictsWithExisting,
  isSlotBookable,
  rewardStateForSession,
  slotBlockReason,
  slotsOverlap,
  type RewardInput,
} from '../src/domain/sessions.js';
import { canPublishAnswer, filterAnswers, publicationBlockReason } from '../src/domain/qa.js';
import type { PublishedAnswer } from '../src/domain/qa.js';

const delivered: RewardInput = {
  status: 'completed',
  completedAt: '2026-06-01T10:00:00.000Z',
  trustCaseOpen: false,
  disputed: false,
};

describe('reward state', () => {
  it('is earned by delivering the session', () => {
    expect(rewardStateForSession(delivered)).toBe('earned');
    expect(rewardStateForSession({ ...delivered, status: 'confirmed', completedAt: null })).toBe(
      'not_earned',
    );
    expect(rewardStateForSession({ ...delivered, status: 'cancelled' })).toBe('not_earned');
  });

  it('withholds while a trust case or a dispute is open', () => {
    expect(rewardStateForSession({ ...delivered, trustCaseOpen: true })).toBe('withheld');
    expect(rewardStateForSession({ ...delivered, disputed: true })).toBe('withheld');
  });

  it('still pays for a student no-show, because the guide held the hour', () => {
    expect(rewardStateForSession({ ...delivered, status: 'no_show' })).toBe('earned');
  });

  /**
   * Phase 3 acceptance criterion 5. Every forbidden input is rejected, not just
   * the obvious one, and the rejection happens at the call site rather than in
   * review.
   */
  it('refuses to be handed an application outcome', () => {
    for (const key of FORBIDDEN_REWARD_INPUTS) {
      expect(() => rewardStateForSession({ ...delivered, [key]: 'accepted' })).toThrow(
        RewardLinkageError,
      );
    }
    expect(() =>
      rewardStateForSession({ ...delivered, applicationStatus: 'rejected' }),
    ).toThrow(/never for what the university decided/);
  });

  it('does not let an admission outcome change the answer by any other route', () => {
    // The same delivered session, whatever happened to the application.
    expect(rewardStateForSession({ ...delivered })).toBe('earned');
    expect(rewardStateForSession({ ...delivered, disputed: false })).toBe('earned');
  });

  it('treats a paid reward as terminal', () => {
    expect(canTransitionReward('earned', 'approved')).toBe(true);
    expect(canTransitionReward('approved', 'paid')).toBe(true);
    expect(canTransitionReward('paid', 'withheld')).toBe(false);
    expect(canTransitionReward('withheld', 'approved')).toBe(true);
  });
});

describe('booking', () => {
  const slot = {
    capacity: 1,
    booked: 0,
    startsAt: '2026-07-01T10:00:00.000Z',
    endsAt: '2026-07-01T10:30:00.000Z',
  };
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('offers a slot only while it is both free and in the future', () => {
    expect(isSlotBookable(slot, now)).toBe(true);
    expect(isSlotBookable({ ...slot, booked: 1 }, now)).toBe(false);
    expect(isSlotBookable(slot, new Date('2026-08-01T00:00:00.000Z'))).toBe(false);
  });

  it('says why a slot is greyed out', () => {
    expect(slotBlockReason(slot, now)).toBeNull();
    expect(slotBlockReason({ ...slot, booked: 1 }, now)).toBe('Fully booked.');
    expect(slotBlockReason(slot, new Date('2026-08-01T00:00:00.000Z'))).toBe('This time has passed.');
  });

  it('detects an overlap when a guide adds a clashing slot', () => {
    const clash = { startsAt: '2026-07-01T10:15:00.000Z', endsAt: '2026-07-01T10:45:00.000Z' };
    const after = { startsAt: '2026-07-01T10:30:00.000Z', endsAt: '2026-07-01T11:00:00.000Z' };
    expect(slotsOverlap(slot, clash)).toBe(true);
    // Touching endpoints are not an overlap: 10:00–10:30 and 10:30–11:00 are fine.
    expect(slotsOverlap(slot, after)).toBe(false);
    expect(conflictsWithExisting(clash, [slot])).toBe(true);
    expect(conflictsWithExisting(after, [slot])).toBe(false);
  });

  it('allows only the legal session transitions', () => {
    expect(canTransitionSession('requested', 'confirmed')).toBe(true);
    expect(canTransitionSession('confirmed', 'completed')).toBe(true);
    expect(canTransitionSession('completed', 'cancelled')).toBe(false);
    expect(canTransitionSession('cancelled', 'confirmed')).toBe(false);
  });
});

describe('public Q&A', () => {
  const answer = {
    state: 'pending_moderation' as const,
    moderatedAt: '2026-06-01T00:00:00.000Z',
    guideConsentedAt: '2026-06-01T00:00:00.000Z',
  };

  it('needs moderation and the guide’s consent, and both are necessary', () => {
    expect(canPublishAnswer(answer, 'active')).toBe(true);
    expect(canPublishAnswer({ ...answer, moderatedAt: null }, 'active')).toBe(false);
    expect(canPublishAnswer({ ...answer, guideConsentedAt: null }, 'active')).toBe(false);
  });

  it('will not put a suspended guide’s name back on the public site', () => {
    expect(canPublishAnswer(answer, 'suspended')).toBe(false);
    expect(publicationBlockReason(answer, 'suspended')).toBe('The guide is not currently active.');
  });

  it('says why an answer is not published', () => {
    expect(publicationBlockReason({ ...answer, moderatedAt: null }, 'active')).toBe('Not moderated yet.');
    expect(publicationBlockReason({ ...answer, guideConsentedAt: null }, 'active')).toMatch(
      /has not agreed/,
    );
    expect(publicationBlockReason(answer, 'active')).toBeNull();
  });

  it('filters published answers on question, body and topic', () => {
    const entries: PublishedAnswer[] = [
      {
        id: 'a1',
        questionId: 'q1',
        question: 'How much is a room in halls?',
        topic: 'accommodation',
        institutionId: 'inst_1',
        institutionName: 'Example University',
        programName: null,
        body: 'About 140 a week, bills included.',
        guideDisplayName: 'Amara O.',
        guideId: 'guide_1',
        publishedAt: '2026-06-01T00:00:00.000Z',
        helpfulCount: 3,
      },
    ];
    expect(filterAnswers(entries, 'halls')).toHaveLength(1);
    expect(filterAnswers(entries, 'bills')).toHaveLength(1);
    expect(filterAnswers(entries, 'accommodation')).toHaveLength(1);
    expect(filterAnswers(entries, 'visa')).toHaveLength(0);
    expect(filterAnswers(entries, '  ')).toHaveLength(1);
  });
});
