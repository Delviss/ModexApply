import { describe, expect, it } from 'vitest';
import {
  canDisplayVerifiedBadge,
  effectiveVerificationState,
} from '../src/domain/verification.js';
import { isStale, publicVisibility, severityForField } from '../src/domain/provenance.js';
import { redactAuditMetadata } from '../src/domain/audit.js';
import { validateRequirement } from '../src/domain/requirements.js';
import { rollUpVerdict } from '../src/domain/eligibility.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('verification claims', () => {
  it('reports a lapsed claim as expired regardless of the stored state', () => {
    expect(
      effectiveVerificationState(
        { state: 'verified', expiresAt: '2026-01-01T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('expired');
  });

  it('shows the verified badge only for a live claim — there is no partial badge', () => {
    expect(canDisplayVerifiedBadge({ state: 'verified', expiresAt: null }, NOW)).toBe(true);
    expect(canDisplayVerifiedBadge({ state: 'pending', expiresAt: null }, NOW)).toBe(false);
    expect(
      canDisplayVerifiedBadge({ state: 'verified', expiresAt: '2026-01-01T00:00:00.000Z' }, NOW),
    ).toBe(false);
    expect(canDisplayVerifiedBadge({ state: 'revoked', expiresAt: null }, NOW)).toBe(false);
  });
});

describe('provenance and freshness', () => {
  it('classifies field severity so money and deadlines hide rather than warn', () => {
    expect(severityForField('tuitionFee')).toBe('blocking');
    expect(severityForField('applicationDeadline')).toBe('blocking');
    expect(severityForField('description')).toBe('warning');
    expect(severityForField('somethingElse')).toBe('none');
  });

  it('flips a record past its SLA to stale', () => {
    // Intake SLA is 7 days; a source last updated 30 days ago has lapsed.
    expect(
      isStale({ sourceUpdatedAt: '2026-05-01T00:00:00.000Z', expiresAt: null }, 'intake', NOW),
    ).toBe(true);
    expect(
      isStale({ sourceUpdatedAt: '2026-05-30T00:00:00.000Z', expiresAt: null }, 'intake', NOW),
    ).toBe(false);
    expect(
      isStale({ sourceUpdatedAt: NOW.toISOString(), expiresAt: '2026-02-01T00:00:00.000Z' }, 'intake', NOW),
    ).toBe(true);
  });

  it('hides a record with a stale blocking field and warns on a stale description', () => {
    expect(publicVisibility('stale', ['tuitionFee'])).toBe('hidden');
    expect(publicVisibility('stale', ['description'])).toBe('visible_with_warning');
    expect(publicVisibility('synced', [])).toBe('visible');
    expect(publicVisibility('failed', [])).toBe('hidden');
  });
});

describe('audit metadata redaction', () => {
  it('strips secrets and document content at every depth', () => {
    const redacted = redactAuditMetadata({
      institutionId: 'inst_1',
      dnsChallengeToken: 'modex-verify=abc123',
      nested: { refreshToken: 'rt_live_x', keep: 'yes' },
    });
    expect(redacted.institutionId).toBe('inst_1');
    expect(redacted.dnsChallengeToken).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).refreshToken).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).keep).toBe('yes');
  });

  it('truncates oversized strings so raw document text cannot leak through', () => {
    const redacted = redactAuditMetadata({ note: 'x'.repeat(5000) });
    expect(String(redacted.note)).toHaveLength(2048 + '…[truncated]'.length);
  });
});

describe('requirements', () => {
  const valid = {
    id: 'req_1',
    programId: 'prog_1',
    intakeId: null,
    ruleType: 'english_language',
    ruleJson: {
      ruleType: 'english_language',
      test: 'ielts',
      overallMinimum: 6.5,
      bandMinimums: { writing: 6 },
    },
    humanSummary: 'IELTS 6.5 overall with no band below 6.0.',
    sourceRef: 'https://example.ac.uk/entry-requirements',
    version: 1,
  };

  it('accepts a record carrying both a machine rule and a human summary', () => {
    expect(validateRequirement(valid).ok).toBe(true);
  });

  it('rejects a record missing the human summary', () => {
    const { humanSummary: _dropped, ...withoutSummary } = valid;
    const result = validateRequirement(withoutSummary);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/humanSummary/);
  });

  it('rejects a record whose machine rule does not match its declared type', () => {
    const result = validateRequirement({ ...valid, ruleType: 'gpa_minimum' });
    expect(result.ok).toBe(false);
  });

  it('rejects a requirement with no source reference', () => {
    expect(validateRequirement({ ...valid, sourceRef: '' }).ok).toBe(false);
  });
});

describe('eligibility roll-up', () => {
  const check = (outcome: 'pass' | 'fail' | 'unknown' | 'missing_data') => ({
    requirementId: 'r',
    ruleType: 'gpa_minimum' as const,
    outcome,
    requirement: 'GPA 3.0 or above',
    studentValue: null,
    reason: 'because',
    sourceRef: null,
    remedy: null,
  });

  it('never lets missing data read as a pass', () => {
    expect(rollUpVerdict([check('pass'), check('missing_data')])).toBe('incomplete');
    expect(rollUpVerdict([check('pass'), check('pass')])).toBe('eligible');
    expect(rollUpVerdict([check('fail'), check('missing_data')])).toBe('not_eligible');
    expect(rollUpVerdict([])).toBe('not_assessable');
    expect(rollUpVerdict([check('pass'), check('unknown')])).toBe('not_assessable');
  });
});
