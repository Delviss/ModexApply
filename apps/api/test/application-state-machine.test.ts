import { describe, expect, it } from 'vitest';
import {
  APPLICATION_STATES,
  APPLICATION_TRANSITIONS,
  canTransition,
  detectRequirementDrift,
  evaluateTransition,
  isTerminalState,
  submissionDisplayState,
  submissionHeadline,
  type ApplicationState,
} from '@modex/contracts';

/**
 * "Every illegal state transition is rejected server-side, with a test per
 * edge" (Phase 4 acceptance criterion 2).
 *
 * Taken literally: the table below is walked exhaustively — every ordered pair
 * of states, 14 × 14 — rather than a hand-picked sample. A sample tests the
 * edges somebody thought of, and the edges somebody thought of are not the ones
 * that cause incidents.
 */
describe('the application state machine', () => {
  it('rejects every pair that is not in the table', () => {
    const refused: string[] = [];
    for (const from of APPLICATION_STATES) {
      for (const to of APPLICATION_STATES) {
        if (from === to) continue;
        const legal = APPLICATION_TRANSITIONS[from].includes(to);
        const refusal = evaluateTransition(from, to, 'system');
        if (!legal) {
          expect(refusal, `${from} → ${to} should be refused`).not.toBeNull();
          expect(refusal?.code).toBe('illegal_transition');
          refused.push(`${from}->${to}`);
        }
      }
    }
    // 14 states, 182 ordered pairs, and only a small minority are legal. If
    // this number moves, somebody widened the machine.
    expect(refused.length).toBe(182 - legalEdgeCount());
  });

  it('refuses a transition to the state the application is already in', () => {
    for (const state of APPLICATION_STATES) {
      expect(evaluateTransition(state, state, 'system')?.code).toBe('same_state');
    }
  });

  it('separates legality from authority', () => {
    // `ready → submitted_pending` is legal, and a student may ask for it.
    expect(evaluateTransition('ready', 'submitted_pending', 'student')).toBeNull();

    // `submitted_pending → submitted` is legal too, but the *applicant* may
    // never declare it. A student who could set this could mark their own
    // application submitted with no receipt behind it — which is the specific
    // harm this phase exists to prevent.
    expect(evaluateTransition('submitted_pending', 'submitted', 'student')?.code).toBe(
      'not_authorised',
    );
    // The pipeline may, having seen a synchronous receipt; and so may the
    // university, whose inbound event *is* the receipt for a connector that
    // could not confirm in the same call.
    expect(evaluateTransition('submitted_pending', 'submitted', 'system')).toBeNull();
    expect(evaluateTransition('submitted_pending', 'submitted', 'university')).toBeNull();

    // A delivery failure stays the pipeline's to report. A university saying no
    // is `rejected`, which is a decision rather than a failure to deliver.
    expect(evaluateTransition('submitted_pending', 'failed', 'university')?.code).toBe(
      'not_authorised',
    );
    expect(evaluateTransition('submitted_pending', 'failed', 'student')?.code).toBe(
      'not_authorised',
    );
  });

  it('does not let a student award themselves an offer or an enrolment', () => {
    expect(evaluateTransition('under_review', 'offer', 'student')?.code).toBe('not_authorised');
    expect(evaluateTransition('accepted', 'enrolled', 'student')?.code).toBe('not_authorised');
    expect(evaluateTransition('under_review', 'offer', 'university')).toBeNull();
    expect(evaluateTransition('accepted', 'enrolled', 'university')).toBeNull();
  });

  it('has no path out of submitted_pending except submitted or failed', () => {
    expect(APPLICATION_TRANSITIONS.submitted_pending).toEqual(['submitted', 'failed']);
    // In particular, no path back to `ready`: editing an application whose
    // payload has already left would make the snapshot describe something that
    // no longer exists.
    expect(canTransition('submitted_pending', 'ready')).toBe(false);
    expect(canTransition('submitted_pending', 'draft')).toBe(false);
  });

  it('lets a failed submission be fixed and resent, but not a rejected one', () => {
    expect(canTransition('failed', 'ready')).toBe(true);
    expect(canTransition('rejected', 'ready')).toBe(false);
    expect(isTerminalState('rejected')).toBe(true);
    expect(isTerminalState('declined')).toBe(true);
    expect(isTerminalState('enrolled')).toBe(true);
  });

  it('never reaches a state with no way out except a declared terminal one', () => {
    const terminals = APPLICATION_STATES.filter(isTerminalState);
    expect(terminals).toEqual([
      'declined',
      'rejected',
      'withdrawn',
      'expired',
      'enrolled',
    ] satisfies ApplicationState[]);
  });
});

/**
 * The copy rule, tested without a browser.
 *
 * "A `submitted_pending` application that has not yet received a durable
 * reference must not display Submitted" is a product guarantee, and it holds
 * here because the sentence is computed rather than passed in.
 */
describe('submission copy', () => {
  it('never claims submission before a receipt', () => {
    // "Not yet submitted" contains the word and is exactly right, so the rule
    // is about the *claim*: nothing short of a receipt may lead with it.
    for (const state of APPLICATION_STATES) {
      const headline = submissionHeadline(state, 'Anytown University', null);
      if (submissionDisplayState(state) === 'confirmed') continue;
      expect(headline, `${state} must not lead with a submission claim`).not.toMatch(
        /^Submitted/,
      );
      expect(headline).not.toContain('confirmed by');
    }
  });

  it('says "Sending to" for submitted_pending, whatever else is true', () => {
    expect(submissionHeadline('submitted_pending', 'Anytown University', null)).toBe(
      'Sending to Anytown University',
    );
    // Even with a reference somehow present, the state decides the sentence.
    expect(submissionHeadline('submitted_pending', 'Anytown University', 'REF-1')).toBe(
      'Sending to Anytown University',
    );
  });

  it('quotes the university and its reference once confirmed', () => {
    expect(submissionHeadline('submitted', 'Anytown University', 'REF-1')).toBe(
      'Submitted · confirmed by Anytown University',
    );
    // Confirmed with no reference is a weaker, and honest, claim.
    expect(submissionHeadline('submitted', 'Anytown University', null)).toBe(
      'Received by Anytown University',
    );
  });

  it('maps every state to exactly one of the four display states', () => {
    const seen = new Set(APPLICATION_STATES.map(submissionDisplayState));
    expect([...seen].sort()).toEqual(['confirmed', 'failed', 'not_submitted', 'sending']);
    expect(submissionDisplayState('draft')).toBe('not_submitted');
    expect(submissionDisplayState('ready')).toBe('not_submitted');
    expect(submissionDisplayState('submitted_pending')).toBe('sending');
    expect(submissionDisplayState('failed')).toBe('failed');
  });
});

/**
 * "A requirement change between draft and submission blocks the submission with
 * a specific, actionable explanation" (acceptance criterion 7).
 */
describe('requirement drift', () => {
  const acknowledged = [
    { id: 'r1', version: 1, humanSummary: 'IELTS 6.5 overall with no band below 6.0.' },
    { id: 'r2', version: 2, humanSummary: 'A 2:1 bachelors degree or equivalent.' },
  ];

  it('passes when nothing moved', () => {
    expect(detectRequirementDrift(acknowledged, acknowledged)).toEqual([]);
  });

  it('blocks and quotes both versions when a rule changed', () => {
    const drift = detectRequirementDrift(acknowledged, [
      { id: 'r1', version: 2, humanSummary: 'IELTS 7.0 overall with no band below 6.5.' },
      acknowledged[1]!,
    ]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.kind).toBe('changed');
    // Specific and actionable: the new wording, the old wording, and the step.
    expect(drift[0]?.explanation).toContain('IELTS 7.0');
    expect(drift[0]?.explanation).toContain('IELTS 6.5');
    expect(drift[0]?.explanation).toContain('mark the application ready again');
  });

  it('blocks on an added requirement', () => {
    const drift = detectRequirementDrift(acknowledged, [
      ...acknowledged,
      { id: 'r3', version: 1, humanSummary: 'A portfolio of recent work.' },
    ]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.kind).toBe('added');
    expect(drift[0]?.explanation).toContain('portfolio');
  });

  it('blocks on a removed requirement too', () => {
    // Not over-caution: a removed requirement usually means the programme
    // version moved underneath the application, and a payload built against
    // one version and validated against another is the reproducibility hole
    // this phase exists to close.
    const drift = detectRequirementDrift(acknowledged, [acknowledged[0]!]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.kind).toBe('removed');
  });

  it('reports every change rather than only the first', () => {
    const drift = detectRequirementDrift(acknowledged, [
      { id: 'r1', version: 3, humanSummary: 'IELTS 7.5.' },
      { id: 'r3', version: 1, humanSummary: 'An interview.' },
    ]);
    expect(drift.map((entry) => entry.kind).sort()).toEqual(['added', 'changed', 'removed']);
  });
});

function legalEdgeCount(): number {
  return APPLICATION_STATES.reduce(
    (total, state) => total + APPLICATION_TRANSITIONS[state].length,
    0,
  );
}
