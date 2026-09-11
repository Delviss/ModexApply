import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@modex/contracts';
import { payloadHash, profileVersionOf, verifySnapshot } from '../src/common/crypto/payload-hash.js';

/**
 * "The submitted payload can be regenerated from the snapshot and byte-compared
 * against what was sent" (acceptance criterion 6).
 *
 * That claim is only meaningful if the bytes are a function of the *values*
 * rather than of the order an object literal happened to be written in — which
 * is what canonicalisation buys and what these tests pin down.
 */
describe('canonical serialisation', () => {
  it('is insensitive to key order at every depth', () => {
    const a = { z: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(payloadHash(a)).toBe(payloadHash(b));
  });

  it('preserves array order, because array order is data', () => {
    // Two documents in a different order is a different submission.
    expect(canonicalJson({ d: [1, 2] })).not.toBe(canonicalJson({ d: [2, 1] }));
  });

  it('drops undefined rather than serialising it as a key', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('renders dates as ISO strings, so a Date and its string hash alike', () => {
    const at = new Date('2026-09-11T09:00:00.000Z');
    expect(payloadHash({ at })).toBe(payloadHash({ at: at.toISOString() }));
  });

  it('distinguishes values that differ only in a nested leaf', () => {
    expect(payloadHash({ p: { grade: 3.4 } })).not.toBe(payloadHash({ p: { grade: 3.5 } }));
  });

  it('produces a stable hash across processes', () => {
    // Pinned literal: a change to the canonical form is a breaking change to
    // every stored snapshot's verifiability, and it should not be possible to
    // make one by accident.
    expect(payloadHash({ a: 1, b: 'two' })).toBe(
      'f15bfc93d70801047473922f67fed863ecc7f82f0677ebb7122923aee81e0f97',
    );
  });
});

describe('snapshot verification', () => {
  const payload = { payloadVersion: 1, documents: [{ versionId: 'v1', checksum: 'abc' }] };

  it('verifies a snapshot against its own stored hash', () => {
    const result = verifySnapshot({ payload, payloadHash: payloadHash(payload) });
    expect(result.valid).toBe(true);
  });

  it('fails when the payload was altered after the hash was taken', () => {
    const stored = payloadHash(payload);
    const tampered = { ...payload, documents: [{ versionId: 'v2', checksum: 'def' }] };
    const result = verifySnapshot({ payload: tampered, payloadHash: stored });
    expect(result.valid).toBe(false);
    expect(result.recomputed).not.toBe(stored);
  });

  it('fails when the hash was altered but the payload was not', () => {
    expect(verifySnapshot({ payload, payloadHash: 'deadbeef' }).valid).toBe(false);
  });
});

describe('profile version', () => {
  it('is identical for identical profile data and different otherwise', () => {
    const profile = { intendedLevel: 'postgraduate_taught', academicRecords: [] };
    expect(profileVersionOf(profile)).toBe(profileVersionOf({ ...profile }));
    expect(profileVersionOf(profile)).not.toBe(
      profileVersionOf({ ...profile, intendedLevel: 'doctorate' }),
    );
  });

  it('is short enough to show but long enough not to collide by accident', () => {
    expect(profileVersionOf({ a: 1 })).toHaveLength(32);
  });
});
