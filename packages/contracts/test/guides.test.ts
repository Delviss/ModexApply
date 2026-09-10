import { describe, expect, it } from 'vitest';
import {
  GUIDE_EXPIRY_URGENT_DAYS,
  GUIDE_SUSPENSION_GRACE_DAYS,
  canGuideSendMessages,
  guideDisplayName,
  guideExpiryUrgency,
  guideLifecycleDecision,
  isGuideDiscoverable,
  toPublicGuideProfile,
  PublicGuideProfileSchema,
  PRIVATE_GUIDE_KEYS,
  type GuideRecord,
  type GuideState,
} from '../src/domain/guides.js';
import {
  TRUST_SCORE_TIEBREAK,
  matchGuides,
  type GuideCandidate,
} from '../src/domain/guide-matching.js';
import { canSendMessage, groupMessagesByDay, type Message } from '../src/domain/messaging.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function guide(overrides: Partial<GuideRecord> = {}): GuideRecord {
  return {
    id: 'guide_1',
    displayName: 'Amara O.',
    avatarRef: null,
    institutionId: 'inst_1',
    institutionName: 'Example University',
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
    userId: 'user_1',
    email: 'amara@example.ac.uk',
    phone: '+44 7700 900123',
    offPlatformHandles: { whatsapp: '+44 7700 900123' },
    legalName: 'Amara Okonkwo',
    evidence: [
      {
        id: 'ev_1',
        guideId: 'guide_1',
        evidenceType: 'student_id_document',
        evidenceRef: 's3://evidence/guide_1/id.pdf',
        verifiedAt: '2026-03-01T00:00:00.000Z',
        expiresAt: '2026-08-30T00:00:00.000Z',
        reviewerId: 'trust_1',
      },
    ],
    internalNotes: 'ID checked against roster.',
    ...overrides,
  };
}

describe('guide state', () => {
  it('lets only an active guide send, and only an active guide be discoverable', () => {
    const states: GuideState[] = ['pending', 'active', 'restricted', 'suspended', 'revoked'];
    for (const state of states) {
      expect(canGuideSendMessages(state)).toBe(state === 'active');
      expect(isGuideDiscoverable(state)).toBe(state === 'active');
    }
  });

  it('shows a first name and last initial, never the legal name', () => {
    expect(guideDisplayName('Amara Chidinma Okonkwo')).toBe('Amara O.');
    expect(guideDisplayName('Li')).toBe('Li');
    expect(guideDisplayName('   ')).toBe('Student guide');
  });
});

describe('the public projection', () => {
  it('drops every private key, including ones stuffed in deliberately', () => {
    const record = guide();
    const published = toPublicGuideProfile(record) as Record<string, unknown>;

    for (const key of PRIVATE_GUIDE_KEYS) {
      expect(published[key]).toBeUndefined();
    }

    // The serialised payload is what actually reaches a browser, so assert on it.
    const serialised = JSON.stringify(published);
    expect(serialised).not.toContain('amara@example.ac.uk');
    expect(serialised).not.toContain('7700 900123');
    expect(serialised).not.toContain('Okonkwo');
    expect(serialised).not.toContain('whatsapp');
    expect(serialised).not.toContain('evidence');
  });

  it('rejects an unknown field rather than passing it through', () => {
    const withExtra = { ...toPublicGuideProfile(guide()), phone: '+44 7700 900123' };
    expect(PublicGuideProfileSchema.safeParse(withExtra).success).toBe(false);
    expect(PublicGuideProfileSchema.safeParse(toPublicGuideProfile(guide())).success).toBe(true);
  });
});

describe('expiry lifecycle', () => {
  const base = {
    state: 'active' as GuideState,
    evidenceExpiresAt: '2026-06-20T00:00:00.000Z',
    expiryNotifiedAt: null as string | null,
  };

  it('notifies once inside the warning window', () => {
    expect(guideLifecycleDecision(base, NOW).action).toBe('notify');
    expect(
      guideLifecycleDecision({ ...base, expiryNotifiedAt: '2026-05-25T00:00:00.000Z' }, NOW).action,
    ).toBe('none');
  });

  it('does nothing while the evidence is comfortably inside its window', () => {
    expect(
      guideLifecycleDecision({ ...base, evidenceExpiresAt: '2026-12-01T00:00:00.000Z' }, NOW).action,
    ).toBe('none');
  });

  it('restricts at expiry and suspends after the grace period, with no human step', () => {
    const expired = { ...base, evidenceExpiresAt: '2026-05-31T00:00:00.000Z' };
    const restrict = guideLifecycleDecision(expired, NOW);
    expect(restrict.action).toBe('restrict');
    expect(restrict.nextState).toBe('restricted');

    const afterGrace = new Date('2026-05-31T00:00:00.000Z');
    afterGrace.setUTCDate(afterGrace.getUTCDate() + GUIDE_SUSPENSION_GRACE_DAYS);
    const suspend = guideLifecycleDecision({ ...expired, state: 'restricted' }, afterGrace);
    expect(suspend.action).toBe('suspend');
    expect(suspend.nextState).toBe('suspended');
  });

  it('is idempotent while the grace period runs', () => {
    const restricted = {
      state: 'restricted' as GuideState,
      evidenceExpiresAt: '2026-05-31T00:00:00.000Z',
      expiryNotifiedAt: '2026-05-01T00:00:00.000Z',
    };
    expect(guideLifecycleDecision(restricted, NOW).action).toBe('none');
  });

  it('never lets the clock undo a suspension', () => {
    expect(
      guideLifecycleDecision(
        { state: 'suspended', evidenceExpiresAt: '2027-01-01T00:00:00.000Z', expiryNotifiedAt: null },
        NOW,
      ).action,
    ).toBe('none');
  });

  it('turns the countdown amber at 30 days and red at 7', () => {
    expect(guideExpiryUrgency('2026-12-01T00:00:00.000Z', NOW)).toBe('none');
    expect(guideExpiryUrgency('2026-06-20T00:00:00.000Z', NOW)).toBe('due');
    expect(guideExpiryUrgency('2026-06-05T00:00:00.000Z', NOW)).toBe('urgent');
    expect(guideExpiryUrgency('2026-05-01T00:00:00.000Z', NOW)).toBe('lapsed');
    const boundary = new Date(NOW.getTime() + GUIDE_EXPIRY_URGENT_DAYS * 86_400_000);
    expect(guideExpiryUrgency(boundary, NOW)).toBe('urgent');
  });
});

describe('matching', () => {
  const candidate = (overrides: Partial<GuideRecord>, openSlots = 2): GuideCandidate => ({
    profile: toPublicGuideProfile(guide({ ...overrides })),
    openSlots,
  });

  const criteria = {
    institutionId: 'inst_1',
    campusId: 'campus_1',
    campusSpecific: true,
    programKey: 'prog_cs',
    level: 'undergraduate' as const,
    languages: ['English'],
    homeCountry: 'NG',
    topics: ['accommodation' as const],
  };

  it('filters on university as a hard rule, not a weight', () => {
    const matches = matchGuides(
      [candidate({ id: 'a' }), candidate({ id: 'b', institutionId: 'inst_2' })],
      criteria,
    );
    expect(matches.map((match) => match.profile.id)).toEqual(['a']);
  });

  it('never lists a guide who is not active', () => {
    const matches = matchGuides(
      [candidate({ id: 'a', state: 'restricted' }), candidate({ id: 'b', state: 'suspended' })],
      criteria,
    );
    expect(matches).toHaveLength(0);
  });

  it('filters on availability only when a session is being booked', () => {
    const roster = [candidate({ id: 'a' }, 0)];
    expect(matchGuides(roster, criteria)).toHaveLength(1);
    expect(matchGuides(roster, { ...criteria, requiresAvailability: true })).toHaveLength(0);
  });

  it('lets trust score break a tie and nothing more', () => {
    const [first, second] = matchGuides(
      [
        candidate({ id: 'low', trustScore: 0 }),
        candidate({ id: 'high', trustScore: 100 }),
      ],
      criteria,
    );
    expect(first?.profile.id).toBe('high');
    expect(second?.profile.id).toBe('low');
    expect((first?.score ?? 0) - (second?.score ?? 0)).toBeLessThanOrEqual(TRUST_SCORE_TIEBREAK);

    // A perfect trust score cannot overtake a guide who matched on one more factor.
    const better = matchGuides(
      [
        candidate({ id: 'trusted', trustScore: 100, topics: [] }),
        candidate({ id: 'matched', trustScore: 0 }),
      ],
      criteria,
    );
    expect(better[0]?.profile.id).toBe('matched');
  });

  it('is smaller than every substantive weight', () => {
    const weights = matchGuides([candidate({ id: 'a' })], criteria)[0]?.factors ?? [];
    for (const factor of weights) {
      if (factor.factor === 'trust_score_tiebreak') continue;
      expect(factor.weight).toBeGreaterThan(TRUST_SCORE_TIEBREAK);
    }
  });

  it('is deterministic, including for identically scored guides', () => {
    const roster = [candidate({ id: 'b' }), candidate({ id: 'a' }), candidate({ id: 'c' })];
    const once = matchGuides(roster, criteria).map((match) => match.profile.id);
    const twice = matchGuides([...roster].reverse(), criteria).map((match) => match.profile.id);
    expect(once).toEqual(['a', 'b', 'c']);
    expect(twice).toEqual(once);
  });

  it('builds the match reason from the factors that actually scored', () => {
    const [match] = matchGuides([candidate({ id: 'a' })], criteria);
    expect(match?.matchReason).toContain('accommodation');
    expect(match?.matchReason).toContain('English');

    // No shared language must not produce a claim of one.
    const [noLanguage] = matchGuides(
      [candidate({ id: 'a', languages: ['French'] })],
      criteria,
    );
    expect(noLanguage?.matchReason).not.toContain('speaks');
  });

  it('says so plainly when nothing matched', () => {
    const [match] = matchGuides(
      [candidate({ id: 'a', topics: [], languages: [], homeCountry: null, programKey: null, campusId: null, level: null })],
      criteria,
    );
    expect(match?.matchReason).toContain('nothing else in your profile matched');
  });
});

describe('sending a message', () => {
  it('refuses a guide who is not active, whatever the client thinks', () => {
    for (const state of ['pending', 'restricted', 'suspended', 'revoked'] as GuideState[]) {
      const decision = canSendMessage({
        senderRole: 'guide',
        guideState: state,
        conversationStatus: 'open',
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).not.toBeNull();
    }
    expect(
      canSendMessage({ senderRole: 'guide', guideState: 'active', conversationStatus: 'open' })
        .allowed,
    ).toBe(true);
  });

  it('refuses anyone once the conversation is suspended or closed', () => {
    expect(
      canSendMessage({ senderRole: 'student', guideState: 'active', conversationStatus: 'suspended' }),
    ).toMatchObject({ allowed: false, code: 'state_transition_rejected' });
    expect(
      canSendMessage({ senderRole: 'student', guideState: 'active', conversationStatus: 'closed' })
        .allowed,
    ).toBe(false);
  });
});

describe('day dividers', () => {
  const message = (id: string, sentAt: string): Message => ({
    id,
    conversationId: 'c1',
    senderId: 'u1',
    senderRole: 'student',
    kind: 'text',
    systemKind: null,
    body: 'hello',
    attachmentRef: null,
    moderationState: 'clean',
    flagSummary: null,
    sentAt,
    readAt: null,
  });

  it('groups by UTC day, in order', () => {
    const groups = groupMessagesByDay([
      message('b', '2026-06-02T09:00:00.000Z'),
      message('a', '2026-06-01T23:00:00.000Z'),
      message('c', '2026-06-02T10:00:00.000Z'),
    ]);
    expect(groups.map((group) => group.day)).toEqual(['2026-06-01', '2026-06-02']);
    expect(groups[1]?.messages.map((entry) => entry.id)).toEqual(['b', 'c']);
  });
});
