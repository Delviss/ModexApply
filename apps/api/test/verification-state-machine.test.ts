import { describe, expect, it } from 'vitest';
import {
  canPublishVerifiedBadge,
  evaluateTransition,
  stageStatuses,
  type StageEvidence,
} from '../src/institutions/verification-state-machine.js';

const noEvidence: StageEvidence = {
  domainConfirmed: false,
  signatoryConfirmed: false,
  contractRef: null,
  legalEntityEvidenceId: null,
};

const fullEvidence: StageEvidence = {
  domainConfirmed: true,
  signatoryConfirmed: true,
  contractRef: 'contract://2026/uni-of-x.pdf',
  legalEntityEvidenceId: 'evidence_1',
};

describe('the verification state machine', () => {
  // The headline acceptance criterion: an institution cannot reach `verified`
  // without a confirmed official domain and a stored contract reference.
  it('refuses the shortcut straight to active', () => {
    const result = evaluateTransition({
      currentStage: null,
      targetStage: 'active',
      evidence: fullEvidence,
      actorIsTrustAgent: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/skip/i);
    expect(result.reason).toMatch(/legal_entity_check/);
  });

  it('refuses to reach active without a confirmed domain, even walking every stage', () => {
    const evidence = { ...fullEvidence, domainConfirmed: false };
    const result = evaluateTransition({
      currentStage: 'signed_contract',
      targetStage: 'active',
      evidence,
      actorIsTrustAgent: true,
      overrideJustification: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/justification/i);
  });

  it('refuses to reach active without a stored contract reference', () => {
    const result = evaluateTransition({
      currentStage: 'signed_contract',
      targetStage: 'active',
      evidence: { ...fullEvidence, contractRef: null },
      actorIsTrustAgent: true,
      overrideJustification: null,
    });
    expect(result.allowed).toBe(false);
  });

  it('advances one stage at a time when the evidence is present', () => {
    const stages = [
      ['legal_entity_check', null],
      ['official_domain_confirmation', 'legal_entity_check'],
      ['partner_contact_confirmation', 'official_domain_confirmation'],
      ['signed_contract', 'partner_contact_confirmation'],
      ['active', 'signed_contract'],
    ] as const;

    for (const [target, current] of stages) {
      const result = evaluateTransition({
        currentStage: current,
        targetStage: target,
        evidence: fullEvidence,
        actorIsTrustAgent: true,
      });
      expect(result.allowed, `${current} -> ${target}`).toBe(true);
    }
  });

  it('marks the institution verified only on reaching active', () => {
    expect(
      evaluateTransition({
        currentStage: 'partner_contact_confirmation',
        targetStage: 'signed_contract',
        evidence: fullEvidence,
        actorIsTrustAgent: true,
      }).nextState,
    ).toBe('pending');

    expect(
      evaluateTransition({
        currentStage: 'signed_contract',
        targetStage: 'active',
        evidence: fullEvidence,
        actorIsTrustAgent: true,
      }).nextState,
    ).toBe('verified');
  });

  it('never moves backwards', () => {
    const result = evaluateTransition({
      currentStage: 'signed_contract',
      targetStage: 'official_domain_confirmation',
      evidence: fullEvidence,
      actorIsTrustAgent: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/only moves forward/i);
  });

  describe('manual override', () => {
    it('is refused outright to a non-trust-agent', () => {
      const result = evaluateTransition({
        currentStage: 'legal_entity_check',
        targetStage: 'official_domain_confirmation',
        evidence: noEvidence,
        actorIsTrustAgent: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.requiresTrustAgent).toBe(true);
      expect(result.reason).toMatch(/trust agent/i);
    });

    it('needs a written justification even from a trust agent', () => {
      const result = evaluateTransition({
        currentStage: 'legal_entity_check',
        targetStage: 'official_domain_confirmation',
        evidence: noEvidence,
        actorIsTrustAgent: true,
        overrideJustification: 'because',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/justification/i);
    });

    it('is allowed, and flagged as an override, with a real justification', () => {
      const result = evaluateTransition({
        currentStage: 'legal_entity_check',
        targetStage: 'official_domain_confirmation',
        evidence: noEvidence,
        actorIsTrustAgent: true,
        overrideJustification:
          'Registrar confirmed ownership by signed letter; the domain is administered by a state ministry.',
      });
      expect(result.allowed).toBe(true);
      expect(result.isManualOverride).toBe(true);
    });
  });

  describe('the badge rule', () => {
    // "Failure at any step means the institution cannot publish Verified Partner
    // University status. There is no partial badge."
    it('shows the verified badge only at active + verified', () => {
      expect(canPublishVerifiedBadge('active', 'verified')).toBe(true);
      expect(canPublishVerifiedBadge('signed_contract', 'verified')).toBe(false);
      expect(canPublishVerifiedBadge('active', 'pending')).toBe(false);
      expect(canPublishVerifiedBadge('active', 'revoked')).toBe(false);
      expect(canPublishVerifiedBadge(null, 'unverified')).toBe(false);
    });
  });

  describe('the pipeline view', () => {
    it('renders done / active / pending across the five stages', () => {
      const statuses = stageStatuses('partner_contact_confirmation', 'pending');
      expect(statuses.map((entry) => entry.status)).toEqual([
        'done',
        'done',
        'active',
        'pending',
        'pending',
      ]);
    });

    it('renders a revoked institution as an error, not as unfinished', () => {
      const statuses = stageStatuses('active', 'revoked');
      expect(statuses.every((entry) => entry.status === 'error')).toBe(true);
    });
  });
});
