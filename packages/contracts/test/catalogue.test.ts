import { describe, expect, it } from 'vitest';
import { canPublishProgram, deriveIntakeStatus } from '../src/domain/catalogue.js';
import {
  hasScope,
  isVerifiedSignatory,
  partnershipIsActive,
} from '../src/domain/institution.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('intake status derivation', () => {
  const base = { startDate: '2026-09-01T00:00:00.000Z', status: 'open' as const };

  it('closes an intake the moment its deadline passes', () => {
    expect(
      deriveIntakeStatus({ ...base, applicationDeadline: '2026-05-31T00:00:00.000Z' }, NOW),
    ).toBe('closed');
  });

  it('flags the last two weeks as closing soon', () => {
    expect(
      deriveIntakeStatus({ ...base, applicationDeadline: '2026-06-10T00:00:00.000Z' }, NOW),
    ).toBe('closing_soon');
    expect(
      deriveIntakeStatus({ ...base, applicationDeadline: '2026-07-30T00:00:00.000Z' }, NOW),
    ).toBe('open');
  });

  it('keeps a cancelled intake cancelled', () => {
    expect(
      deriveIntakeStatus(
        { ...base, status: 'cancelled', applicationDeadline: '2026-07-30T00:00:00.000Z' },
        NOW,
      ),
    ).toBe('cancelled');
  });
});

describe('partnership gating', () => {
  const active = {
    status: 'active' as const,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2027-01-01T00:00:00.000Z',
    scopes: ['catalogue_publish' as const],
  };

  it('treats an expired or suspended partnership as inactive', () => {
    expect(partnershipIsActive(active, NOW)).toBe(true);
    expect(partnershipIsActive({ ...active, status: 'suspended' }, NOW)).toBe(false);
    expect(partnershipIsActive({ ...active, endDate: '2026-02-01T00:00:00.000Z' }, NOW)).toBe(false);
    expect(partnershipIsActive({ ...active, startDate: '2026-12-01T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('requires the specific scope, not merely an active partnership', () => {
    expect(hasScope(active, 'catalogue_publish', NOW)).toBe(true);
    expect(hasScope(active, 'direct_application', NOW)).toBe(false);
  });

  it('only counts an on-domain, verified contact as an authorised signatory', () => {
    const domains = ['example.ac.uk'];
    expect(
      isVerifiedSignatory(
        { isAuthorisedSignatory: true, verifiedAt: '2026-01-01T00:00:00.000Z', email: 'r@example.ac.uk' },
        domains,
      ),
    ).toBe(true);
    expect(
      isVerifiedSignatory(
        { isAuthorisedSignatory: true, verifiedAt: '2026-01-01T00:00:00.000Z', email: 'r@gmail.com' },
        domains,
      ),
    ).toBe(false);
    expect(
      isVerifiedSignatory(
        { isAuthorisedSignatory: true, verifiedAt: null, email: 'r@example.ac.uk' },
        domains,
      ),
    ).toBe(false);
  });
});

describe('programme publication gate', () => {
  const futureIntake = [
    { applicationDeadline: '2026-08-01T00:00:00.000Z', status: 'open' as const },
  ];

  it('publishes only with an active partnership, the scope, and a future intake', () => {
    expect(
      canPublishProgram({
        partnershipActive: true,
        hasCataloguePublishScope: true,
        intakes: futureIntake,
        now: NOW,
      }),
    ).toEqual({ ok: true, reason: null });
  });

  it('refuses without an active partnership', () => {
    const result = canPublishProgram({
      partnershipActive: false,
      hasCataloguePublishScope: true,
      intakes: futureIntake,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/active partnership/);
  });

  it('refuses when every intake deadline has passed', () => {
    const result = canPublishProgram({
      partnershipActive: true,
      hasCataloguePublishScope: true,
      intakes: [{ applicationDeadline: '2026-01-01T00:00:00.000Z', status: 'open' }],
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/future application deadline/);
  });
});
