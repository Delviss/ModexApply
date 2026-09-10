import { describe, expect, it } from 'vitest';
import {
  connectorBlockReason,
  expiryState,
  isConnectorEligible,
  isPermanentlyBlocked,
  SCAN_STATES,
  type DocumentVersion,
} from '../src/domain/documents.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id: 'dv_1',
    documentId: 'doc_1',
    version: 1,
    objectKey: 'documents/9f2c/6a1e-…',
    checksum: 'a'.repeat(64),
    sizeBytes: 182_311,
    contentType: 'application/pdf',
    scanState: 'clean',
    scannedAt: '2026-05-30T00:00:00.000Z',
    scanDetail: null,
    uploadComplete: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('the connector boundary', () => {
  it('passes only a clean, complete, checksummed version', () => {
    expect(isConnectorEligible(version())).toBe(true);
  });

  // Fail-closed by construction. Every state that is not `clean` is refused,
  // and this loop is what proves a state added later is refused by default
  // rather than falling through some `!== 'quarantined'` check.
  it('refuses every scan state except clean', () => {
    for (const scanState of SCAN_STATES) {
      const eligible = isConnectorEligible(version({ scanState }));
      expect(eligible).toBe(scanState === 'clean');
    }
  });

  // A row whose bytes never landed has a pending scan and no checksum. Without
  // this it would be one scanner bug away from looking acceptable.
  it('refuses a version whose upload never finished, even if marked clean', () => {
    expect(isConnectorEligible(version({ uploadComplete: false }))).toBe(false);
    expect(isConnectorEligible(version({ checksum: null }))).toBe(false);
  });

  it('explains every refusal in words a student reads, and only a refusal', () => {
    expect(connectorBlockReason(version())).toBeNull();
    for (const scanState of SCAN_STATES.filter((state) => state !== 'clean')) {
      const reason = connectorBlockReason(version({ scanState }));
      expect(reason).not.toBeNull();
      expect(reason!.length).toBeGreaterThan(20);
    }
  });

  it('says a quarantined file is blocked, not retryable', () => {
    const blocked = version({ scanState: 'quarantined' });
    expect(isPermanentlyBlocked(blocked)).toBe(true);
    expect(connectorBlockReason(blocked)).toMatch(/cannot be used/i);
    expect(isPermanentlyBlocked(version({ scanState: 'failed' }))).toBe(false);
  });
});

describe('expiry', () => {
  it('distinguishes valid, expiring, expired and no expiry', () => {
    expect(expiryState({ expiryAt: null }, NOW)).toBe('no_expiry');
    expect(expiryState({ expiryAt: '2029-01-01T00:00:00.000Z' }, NOW)).toBe('valid');
    expect(expiryState({ expiryAt: '2026-07-15T00:00:00.000Z' }, NOW)).toBe('expiring_soon');
    expect(expiryState({ expiryAt: '2026-05-31T00:00:00.000Z' }, NOW)).toBe('expired');
  });
});
