import {
  VERIFICATION_STAGES,
  type VerificationStage,
  type VerificationState,
} from '@modex/contracts';

/**
 * The institution verification pipeline (Phase 1 section 2).
 *
 *   legal entity check -> official domain confirmation -> partner contact
 *   confirmation -> signed contract -> active
 *
 * Two rules the whole trust model rests on:
 *
 *  1. **No stage skipping.** The only legal move is forward exactly one stage,
 *     with that stage's evidence present. An institution cannot reach `verified`
 *     without a confirmed official domain and a stored contract reference, and
 *     the transition function refuses the shortcut rather than trusting callers
 *     to walk the stages in order.
 *
 *  2. **No partial badge.** Failure at any step means the institution cannot
 *     publish "Verified Partner University" status. There is no intermediate
 *     public badge to fall back to, so this file has no such state.
 *
 * A manual override is possible -- some legal-entity checks genuinely cannot be
 * automated -- but only for a trust agent, only with a recorded justification,
 * and it always writes an audit event. `requiresTrustAgent` marks which
 * transitions those are.
 */

export interface StageEvidence {
  /** A confirmed DNS TXT record or on-domain email challenge. */
  domainConfirmed: boolean;
  /** A verified contact on an official domain, flagged as authorised signatory. */
  signatoryConfirmed: boolean;
  /** Pointer to the executed contract in secure storage. */
  contractRef: string | null;
  /** Evidence recorded for the legal-entity check. */
  legalEntityEvidenceId: string | null;
}

export interface TransitionRequest {
  currentStage: VerificationStage | null;
  targetStage: VerificationStage;
  evidence: StageEvidence;
  /** True when the actor holds `institution:verify` (a trust agent). */
  actorIsTrustAgent: boolean;
  /** Required for any manual override. */
  overrideJustification?: string | null;
}

export interface TransitionResult {
  allowed: boolean;
  reason: string | null;
  /** State the institution takes on if the transition is applied. */
  nextState: VerificationState;
  requiresTrustAgent: boolean;
  isManualOverride: boolean;
}

const STAGE_ORDER = new Map<VerificationStage, number>(
  VERIFICATION_STAGES.map((stage, index) => [stage, index]),
);

/** What must be true *before* a stage may be entered. */
const STAGE_PRECONDITIONS: Record<
  VerificationStage,
  { check: (evidence: StageEvidence) => boolean; requirement: string; trustAgentOnly: boolean }
> = {
  legal_entity_check: {
    check: (evidence) => evidence.legalEntityEvidenceId !== null,
    requirement: 'Legal-entity evidence must be recorded before this stage can complete.',
    trustAgentOnly: true,
  },
  official_domain_confirmation: {
    check: (evidence) => evidence.domainConfirmed,
    requirement:
      'An official domain must be confirmed by DNS TXT record or an on-domain challenge.',
    trustAgentOnly: false,
  },
  partner_contact_confirmation: {
    check: (evidence) => evidence.signatoryConfirmed,
    requirement: 'A named authorised signatory must be verified on an official domain.',
    trustAgentOnly: false,
  },
  signed_contract: {
    check: (evidence) => evidence.contractRef !== null && evidence.contractRef !== '',
    requirement: 'An executed contract reference must be stored.',
    trustAgentOnly: true,
  },
  active: {
    // Reaching `active` re-asserts every prior condition, so a later revocation
    // of any single one cannot leave an institution stranded in `active`.
    check: (evidence) =>
      evidence.domainConfirmed &&
      evidence.signatoryConfirmed &&
      evidence.contractRef !== null &&
      evidence.contractRef !== '' &&
      evidence.legalEntityEvidenceId !== null,
    requirement:
      'Every prior stage must still hold: legal entity, confirmed domain, verified signatory and a stored contract.',
    trustAgentOnly: true,
  },
};

export function evaluateTransition(request: TransitionRequest): TransitionResult {
  const currentIndex =
    request.currentStage === null ? -1 : (STAGE_ORDER.get(request.currentStage) ?? -1);
  const targetIndex = STAGE_ORDER.get(request.targetStage) ?? -1;

  if (targetIndex === -1) {
    return reject(`"${request.targetStage}" is not a verification stage.`);
  }

  if (targetIndex <= currentIndex) {
    return reject(
      `Cannot move back to ${request.targetStage} from ${request.currentStage ?? 'the start'}. ` +
        'Verification only moves forward; withdraw the claim instead.',
    );
  }

  if (targetIndex > currentIndex + 1) {
    const skipped = VERIFICATION_STAGES.slice(currentIndex + 1, targetIndex);
    return reject(
      `Cannot skip ${skipped.join(', ')}. Verification advances one stage at a time.`,
    );
  }

  const precondition = STAGE_PRECONDITIONS[request.targetStage];
  const preconditionMet = precondition.check(request.evidence);
  const isManualOverride = !preconditionMet;

  if (isManualOverride) {
    // An override is a real, occasionally necessary act. It is not a quiet one:
    // trust agent, written justification, audit event.
    if (!request.actorIsTrustAgent) {
      return {
        allowed: false,
        reason: `${precondition.requirement} Only a Modex trust agent may override this.`,
        nextState: 'pending',
        requiresTrustAgent: true,
        isManualOverride: true,
      };
    }
    const justification = request.overrideJustification?.trim() ?? '';
    if (justification.length < 20) {
      return {
        allowed: false,
        reason:
          'A manual override needs a written justification of at least 20 characters, ' +
          'which is recorded in the audit trail.',
        nextState: 'pending',
        requiresTrustAgent: true,
        isManualOverride: true,
      };
    }
  }

  if (precondition.trustAgentOnly && !request.actorIsTrustAgent) {
    return {
      allowed: false,
      reason: `Advancing to ${request.targetStage} is a Modex trust agent action.`,
      nextState: 'pending',
      requiresTrustAgent: true,
      isManualOverride,
    };
  }

  return {
    allowed: true,
    reason: null,
    nextState: request.targetStage === 'active' ? 'verified' : 'pending',
    requiresTrustAgent: precondition.trustAgentOnly,
    isManualOverride,
  };
}

/**
 * Whether the institution may publish the "Verified Partner University" badge.
 * There is no partial badge: anything short of `active` and `verified` is no.
 */
export function canPublishVerifiedBadge(
  stage: VerificationStage | null,
  state: VerificationState,
): boolean {
  return stage === 'active' && state === 'verified';
}

/** Renders the pipeline for the Task Steps view in the trust console. */
export function stageStatuses(
  currentStage: VerificationStage | null,
  state: VerificationState,
): { stage: VerificationStage; status: 'pending' | 'active' | 'done' | 'error' }[] {
  const currentIndex = currentStage === null ? -1 : (STAGE_ORDER.get(currentStage) ?? -1);
  return VERIFICATION_STAGES.map((stage, index) => {
    if (state === 'revoked' && index <= currentIndex) return { stage, status: 'error' as const };
    if (index < currentIndex) return { stage, status: 'done' as const };
    if (index === currentIndex) {
      return { stage, status: state === 'verified' ? ('done' as const) : ('active' as const) };
    }
    return { stage, status: 'pending' as const };
  });
}

function reject(reason: string): TransitionResult {
  return {
    allowed: false,
    reason,
    nextState: 'pending',
    requiresTrustAgent: false,
    isManualOverride: false,
  };
}
