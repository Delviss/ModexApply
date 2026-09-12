import { describe, expect, it } from 'vitest';
import {
  STEP_UP_TTL_MINUTES,
  canAccessUniversityPortal,
  checkDualApproval,
  connectorHealth,
  consolesFor,
  describesChange,
  highValueThresholdFor,
  isImpersonationActive,
  isStepUpFresh,
  isSubmissionStuck,
  requiresDualApproval,
  silencesGuide,
  unknownPlaceholders,
} from '@modex/contracts';

/**
 * The Phase 6 rules, tested where they live.
 *
 * Every one of these decides something a console renders *and* something the
 * API enforces. Testing them here rather than through an endpoint is what keeps
 * the two halves from drifting apart.
 */
describe('step-up freshness', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('is not fresh when the session has never stepped up', () => {
    expect(isStepUpFresh(null, now)).toBe(false);
  });

  it('is fresh inside the window and stale outside it', () => {
    const inside = new Date(now.getTime() - (STEP_UP_TTL_MINUTES - 1) * 60_000);
    const outside = new Date(now.getTime() - (STEP_UP_TTL_MINUTES + 1) * 60_000);
    expect(isStepUpFresh(inside, now)).toBe(true);
    expect(isStepUpFresh(outside, now)).toBe(false);
  });

  it('refuses a step-up stamped in the future', () => {
    // A clock skew or a forged value. Either way it is not evidence that
    // somebody authenticated a moment ago.
    expect(isStepUpFresh(new Date(now.getTime() + 60_000), now)).toBe(false);
  });

  it('refuses an unparseable timestamp rather than treating it as fresh', () => {
    expect(isStepUpFresh('not-a-date', now)).toBe(false);
  });
});

describe('dual approval', () => {
  it('does not demand a second actor below the threshold', () => {
    expect(requiresDualApproval(1_000, 'GBP')).toBe(false);
    const check = checkDualApproval({
      amountMinor: 1_000,
      currency: 'GBP',
      initiatedBy: 'operator-1',
      approverId: 'operator-1',
    });
    expect(check.ok).toBe(true);
  });

  it('refuses the initiator on a high-value payout, with a reason to render', () => {
    const check = checkDualApproval({
      amountMinor: 500_000,
      currency: 'GBP',
      initiatedBy: 'operator-1',
      approverId: 'operator-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('someone other than you');
  });

  it('allows a different approver on the same payout', () => {
    const check = checkDualApproval({
      amountMinor: 500_000,
      currency: 'GBP',
      initiatedBy: 'operator-1',
      approverId: 'operator-2',
    });
    expect(check.ok).toBe(true);
  });

  it('treats an unconfigured currency as the strictest case, not the loosest', () => {
    // The failure mode this prevents: adding a currency to the product and
    // silently exempting every payout in it from dual approval.
    expect(highValueThresholdFor('XYZ')).toBe(0);
    expect(requiresDualApproval(1, 'XYZ')).toBe(true);
  });
});

describe('connector health', () => {
  it('reports idle rather than healthy when nothing has been attempted', () => {
    expect(connectorHealth({ attempts: 0, succeeded: 0, deadLettered: 0, p95LatencyMs: null })).toBe(
      'idle',
    );
  });

  it('is failing the moment anything dead-letters', () => {
    expect(
      connectorHealth({ attempts: 100, succeeded: 99, deadLettered: 1, p95LatencyMs: 200 }),
    ).toBe('failing');
  });

  it('grades by success rate otherwise', () => {
    expect(
      connectorHealth({ attempts: 100, succeeded: 96, deadLettered: 0, p95LatencyMs: 200 }),
    ).toBe('healthy');
    expect(
      connectorHealth({ attempts: 100, succeeded: 85, deadLettered: 0, p95LatencyMs: 200 }),
    ).toBe('degraded');
    expect(
      connectorHealth({ attempts: 100, succeeded: 50, deadLettered: 0, p95LatencyMs: 200 }),
    ).toBe('failing');
  });
});

describe('submission exceptions', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('only counts submitted_pending as stuck', () => {
    expect(
      isSubmissionStuck({ state: 'submitted', updatedAt: new Date('2026-01-01') }, now),
    ).toBe(false);
  });

  it('counts a pending submission past the threshold', () => {
    expect(
      isSubmissionStuck(
        { state: 'submitted_pending', updatedAt: new Date(now.getTime() - 2 * 3_600_000) },
        now,
      ),
    ).toBe(true);
    expect(
      isSubmissionStuck(
        { state: 'submitted_pending', updatedAt: new Date(now.getTime() - 60_000) },
        now,
      ),
    ).toBe(false);
  });
});

describe('portal access', () => {
  it('is refused without a confirmed domain, whatever the verification state says', () => {
    expect(
      canAccessUniversityPortal({ verificationState: 'verified', domainConfirmedAt: null }),
    ).toBe(false);
  });

  it('is refused when verification lapsed, even with an old confirmed domain', () => {
    expect(
      canAccessUniversityPortal({
        verificationState: 'expired',
        domainConfirmedAt: new Date('2026-01-01'),
      }),
    ).toBe(false);
  });

  it('is allowed with both', () => {
    expect(
      canAccessUniversityPortal({
        verificationState: 'verified',
        domainConfirmedAt: new Date('2026-01-01'),
      }),
    ).toBe(true);
  });
});

describe('console visibility', () => {
  it('shows each staff role its own console', () => {
    expect(consolesFor(['trust_agent'])).toEqual(['trust']);
    expect(consolesFor(['finance'])).toEqual(['finance']);
    expect(consolesFor(['ops'])).toEqual(['operations']);
    expect(consolesFor(['university_staff'])).toEqual(['university']);
  });

  it('shows a student nothing', () => {
    expect(consolesFor(['student'])).toEqual([]);
  });

  it('shows superadmin all four', () => {
    expect(consolesFor(['superadmin'])).toHaveLength(4);
  });
});

describe('sanctions and reviews', () => {
  it('knows which sanctions silence a guide', () => {
    expect(silencesGuide('warn')).toBe(false);
    expect(silencesGuide('restrict')).toBe(false);
    expect(silencesGuide('suspend')).toBe(true);
    expect(silencesGuide('ban')).toBe(true);
  });

  it('rejects an override that changes nothing', () => {
    expect(describesChange({ decision: 'overridden', reason: 'because' })).toBe(false);
    expect(
      describesChange({ decision: 'overridden', reason: 'because', humanSummary: 'New wording' }),
    ).toBe(true);
    expect(describesChange({ decision: 'approved', reason: 'looks right' })).toBe(true);
  });
});

describe('impersonation window', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('is inactive once ended, even inside the window', () => {
    expect(
      isImpersonationActive(
        {
          startedAt: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 600_000),
          endedAt: new Date(now.getTime() - 1_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it('is inactive past its expiry even when nothing closed it', () => {
    expect(
      isImpersonationActive(
        {
          startedAt: new Date(now.getTime() - 3_600_000),
          expiresAt: new Date(now.getTime() - 60_000),
          endedAt: null,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('notification templates', () => {
  it('accepts known placeholders', () => {
    expect(unknownPlaceholders('Hello {{studentName}}, about {{programName}}.')).toEqual([]);
  });

  it('names the ones it will not fill', () => {
    // The failure mode: an operator writes {{user.passwordHash}} and the
    // renderer obligingly reaches into whatever object it was handed.
    expect(unknownPlaceholders('Hi {{user.passwordHash}} and {{secret}}')).toEqual([
      'user.passwordHash',
      'secret',
    ]);
  });
});
