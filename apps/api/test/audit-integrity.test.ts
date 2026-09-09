import { describe, expect, it } from 'vitest';
import {
  GENESIS_INTEGRITY_REF,
  computeIntegrityRef,
  verifyChain,
  type ChainableEvent,
} from '../src/audit/integrity.js';
import { redactAuditMetadata } from '@modex/contracts';

function event(overrides: Partial<ChainableEvent> = {}): ChainableEvent {
  return {
    actorId: 'user_1',
    actorType: 'user',
    action: 'institution.verification_advanced',
    objectType: 'institution',
    objectId: 'inst_1',
    timestamp: '2026-06-01T00:00:00.000Z',
    correlationId: 'corr_1',
    metadata: { toStage: 'active' },
    ...overrides,
  };
}

function chain(events: ChainableEvent[]) {
  let previous = GENESIS_INTEGRITY_REF;
  return events.map((entry, index) => {
    const integrityRef = computeIntegrityRef(entry, previous);
    previous = integrityRef;
    return { ...entry, integrityRef, id: `event_${index}` };
  });
}

describe('the audit hash chain', () => {
  it('verifies an untouched chain', () => {
    expect(verifyChain(chain([event(), event({ action: 'program.published' })]))).toEqual({
      valid: true,
      brokenAtId: null,
    });
  });

  // Tamper *evidence*, not tamper prevention: the point is that a removal at the
  // storage layer stops verifying.
  it('detects a deleted event', () => {
    const events = chain([event(), event({ action: 'program.published' }), event({ action: 'program.unpublished' })]);
    const withHole = [events[0]!, events[2]!];
    expect(verifyChain(withHole).valid).toBe(false);
  });

  it('detects an edited event', () => {
    const events = chain([event(), event({ action: 'program.published' })]);
    const tampered = [events[0]!, { ...events[1]!, objectId: 'inst_other' }];
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe('event_1');
  });

  it('detects a reordered pair', () => {
    const events = chain([event(), event({ action: 'program.published' })]);
    expect(verifyChain([events[1]!, events[0]!]).valid).toBe(false);
  });

  it('does not change the hash when metadata key order changes', () => {
    const a = computeIntegrityRef(event({ metadata: { a: 1, b: 2 } }), GENESIS_INTEGRITY_REF);
    const b = computeIntegrityRef(event({ metadata: { b: 2, a: 1 } }), GENESIS_INTEGRITY_REF);
    expect(a).toBe(b);
  });

  it('does change the hash when metadata content changes', () => {
    const a = computeIntegrityRef(event({ metadata: { toStage: 'active' } }), GENESIS_INTEGRITY_REF);
    const b = computeIntegrityRef(event({ metadata: { toStage: 'signed_contract' } }), GENESIS_INTEGRITY_REF);
    expect(a).not.toBe(b);
  });
});

describe('audit metadata', () => {
  it('is redacted before it is chained, so a secret never reaches the hash input', () => {
    const raw = { dnsChallengeToken: 'modex-verification=secret', domain: 'example.ac.uk' };
    const redacted = redactAuditMetadata(raw);
    expect(redacted.dnsChallengeToken).toBe('[redacted]');

    const refFromRaw = computeIntegrityRef(event({ metadata: raw }), GENESIS_INTEGRITY_REF);
    const refFromRedacted = computeIntegrityRef(event({ metadata: redacted }), GENESIS_INTEGRITY_REF);
    expect(refFromRaw).not.toBe(refFromRedacted);
  });
});
